import type { z } from "zod";
import { AppError } from "@/lib/core/errors";
import { jsonSchemaFor } from "./gemini";
import type { TextGenerationRequest, TextGenerationResult, TextProvider, TokenUsage } from "./types";

/**
 * OpenRouter takes the whole list in one request and routes down it, so this is
 * its hard limit, not a preference: more than three is a 400 and no answer.
 */
export const MAX_OPENROUTER_MODELS = 3;

/**
 * Free models with structured output. OpenRouter tries them in order when one is busy or gone.
 *
 * Checked 2026-09-22: deepseek-v4-flash is no longer free (404 pointing at the
 * paid slug), so it used to burn the first slot on a model that could never answer.
 */
export const DEFAULT_OPENROUTER_MODELS = ["nvidia/nemotron-3-super-120b-a12b:free", "nex-agi/nex-n2.5-pro:free", "qwen/qwen3.8-27b:free"];

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/** Output budget multiplier so reasoning doesn't crowd out the answer. Free models cost nothing per token. */
const REASONING_HEADROOM = 3;

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
 * The JSON in a free model's reply. Asked for a schema, some still say
 * "Here are the labels:" first, leave <think> notes in, or fence it halfway
 * down, and every batch like that used to be thrown away whole.
 */
export function extractJson(text: string): string {
  const cleaned = stripCodeFence(text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim());
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    // Fall through to looking for it.
  }
  const fenced = cleaned.match(/`{3}(?:json)?\s*\n([\s\S]*?)`{3}/i);
  if (fenced) return fenced[1]!.trim();
  const start = cleaned.search(/[[{]/);
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  return start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
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
    // Trimmed rather than rejected: a fourth model in config shouldn't be the
    // reason nothing gets written.
    this.models = (options.models?.length ? options.models : DEFAULT_OPENROUTER_MODELS).slice(0, MAX_OPENROUTER_MODELS);
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
      parsed = JSON.parse(extractJson(text));
    } catch {
      // The ends of the reply say which way it went wrong: a preamble, a cut-off, or prose.
      const sample = { model, length: text.length, start: text.slice(0, 160), end: text.slice(-160) };
      throw new AppError("UPSTREAM_ERROR", `${request.schemaName}: the model returned invalid JSON.`, { details: sample, retryable: true });
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
    const models = request.model ? [request.model] : this.models;
    // A free model sometimes answers with nothing at all; OpenRouter counts that as
    // a success, so try the rest of the list before giving up on the batch.
    for (let i = 0; ; i++) {
      const result = await this.sendOnce(request, models.slice(i), jsonSchema);
      if (result.text.trim() || i >= models.length - 1) return result;
    }
  }

  private async sendOnce(request: TextGenerationRequest, models: string[], jsonSchema?: { name: string; schema: unknown }) {
    const [model = this.models[0]!, ...fallbacks] = models;
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
        // The free models reason before answering, and that counts against max_tokens: keep the
        // reasoning short and out of the reply, and leave room for it on top of the answer.
        reasoning: { effort: request.effort ?? "low", exclude: true },
        ...(request.maxOutputTokens ? { max_tokens: request.maxOutputTokens * REASONING_HEADROOM } : {}),
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
