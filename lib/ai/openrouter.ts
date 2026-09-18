import type { z } from "zod";
import { AppError } from "@/lib/core/errors";
import { jsonSchemaFor } from "./gemini";
import type { TextGenerationRequest, TextGenerationResult, TextProvider, TokenUsage } from "./types";

/** Free models with structured output. OpenRouter tries them in order when one is busy or gone. */
export const DEFAULT_OPENROUTER_MODELS = ["deepseek/deepseek-v4-flash-0731:free", "qwen/qwen3.8-27b:free", "nvidia/nemotron-3-super-120b-a12b:free"];

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/** Thrown for 429s and outages so a fallback chain moves on to the next provider. */
export class OpenRouterUnavailableError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "OpenRouterUnavailableError";
  }
}

interface ChatCompletion {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: number };
}

/** Some models wrap JSON in a code fence despite the schema. */
function stripCodeFence(text: string): string {
  const fence = "`".repeat(3);
  const trimmed = text.trim();
  if (!trimmed.startsWith(fence)) return trimmed;
  return trimmed.slice(trimmed.indexOf("\n") + 1, trimmed.lastIndexOf(fence)).trim();
}

/**
 * OpenRouter's OpenAI-compatible chat API, mainly for its free models as a
 * backup when Gemini's free tier runs out. Structured answers are validated
 * with Zod because not every model honors the JSON schema exactly.
 */
export class OpenRouterTextProvider implements TextProvider {
  readonly name = "openrouter";
  private readonly apiKey: string;
  private readonly models: string[];
  private readonly fetchImpl: typeof fetch;

  constructor(options: { apiKey: string; models?: string[]; fetch?: typeof fetch }) {
    this.apiKey = options.apiKey;
    this.models = options.models?.length ? options.models : DEFAULT_OPENROUTER_MODELS;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async generateText(request: TextGenerationRequest): Promise<TextGenerationResult> {
    const { text, model, usage, finishReason } = await this.send(request);
    return { text, model, usage, stopReason: finishReason };
  }

  async generateObject<T extends z.ZodType>(
    request: TextGenerationRequest & { schema: T; schemaName: string },
  ): Promise<{ object: z.infer<T>; model: string; usage: TokenUsage }> {
    const { text, model, usage } = await this.send(request, { name: request.schemaName, schema: jsonSchemaFor(request.schema) });
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripCodeFence(text));
    } catch {
      throw new AppError("UPSTREAM_ERROR", `${request.schemaName}: the model returned invalid JSON.`, { retryable: true });
    }
    const result = request.schema.safeParse(parsed);
    if (!result.success) {
      throw new AppError("UPSTREAM_ERROR", `${request.schemaName}: the model's output didn't match the schema.`, {
        details: { issues: result.error.issues.slice(0, 5) },
        retryable: true,
      });
    }
    return { object: result.data, model, usage };
  }

  private async send(request: TextGenerationRequest, jsonSchema?: { name: string; schema: unknown }) {
    const [model = this.models[0]!, ...fallbacks] = request.model ? [request.model] : this.models;
    const messages = [
      ...(request.system ? [{ role: "system", content: request.system }] : []),
      ...request.messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const response = await this.fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://www.useoutlier.online",
        "X-Title": "Outlier",
      },
      body: JSON.stringify({
        model,
        ...(fallbacks.length ? { models: [model, ...fallbacks] } : {}),
        messages,
        ...(request.maxOutputTokens ? { max_tokens: request.maxOutputTokens } : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(jsonSchema ? { response_format: { type: "json_schema", json_schema: { name: jsonSchema.name, strict: true, schema: jsonSchema.schema } } } : {}),
      }),
      signal: request.signal,
    });

    const body = (await response.json().catch(() => ({}))) as ChatCompletion;
    if (!response.ok || body.error) {
      const status = body.error?.code ?? response.status;
      const message = body.error?.message ?? `HTTP ${response.status}`;
      if (status === 429 || status >= 500) throw new OpenRouterUnavailableError(status, `OpenRouter unavailable (${status}): ${message}`);
      throw new AppError("CONFIG_ERROR", `OpenRouter rejected the request (${status}): ${message}`, { retryable: false });
    }

    const choice = body.choices?.[0];
    const finishReason = choice?.finish_reason ?? null;
    if (finishReason === "length") throw new AppError("UPSTREAM_ERROR", "The OpenRouter model ran out of output tokens before finishing.", { retryable: false });
    return {
      text: choice?.message?.content ?? "",
      model: body.model ?? model,
      usage: { inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0 },
      finishReason,
    };
  }
}
