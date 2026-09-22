import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { AppError } from "@/lib/core/errors";
import type { TextGenerationRequest, TextGenerationResult, TextProvider, TokenUsage } from "./types";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";

/** Server-side refusal fallbacks ("default" mode) are offered on these models. */
const FALLBACK_MODELS = new Set(["claude-opus-5", "claude-fable-5-1", "claude-mythos-5-1"]);

/** Haiku 4.5 and pre-4.6 Sonnet reject the effort setting. */
function supportsEffort(model: string): boolean {
  return !model.startsWith("claude-haiku") && !model.startsWith("claude-sonnet-4-5");
}

/**
 * Claude through the official SDK. Requests carry server-side refusal fallbacks
 * ("default" routes a declined request to Anthropic's recommended model), and the
 * system prompt is marked cacheable because batch jobs repeat it on every call.
 * Sampling parameters are not sent: current models reject them.
 */
export class AnthropicTextProvider implements TextProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(options: { apiKey?: string; model?: string; client?: Anthropic } = {}) {
    this.client = options.client ?? new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
    this.model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
  }

  private readonly model: string;

  async generateText(request: TextGenerationRequest): Promise<TextGenerationResult> {
    const response = await this.send(request);
    return { text: textOf(response), model: response.model, usage: usageOf(response), stopReason: response.stop_reason };
  }

  async generateObject<T extends z.ZodType>(
    request: TextGenerationRequest & { schema: T; schemaName: string },
  ): Promise<{ object: z.infer<T>; model: string; usage: TokenUsage }> {
    const response = await this.send(request, zodOutputFormat(request.schema));
    const text = textOf(response);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AppError("UPSTREAM_ERROR", `${request.schemaName}: the model returned invalid JSON.`, { details: { stopReason: response.stop_reason }, retryable: true });
    }
    const result = request.schema.safeParse(parsed);
    if (!result.success) {
      throw new AppError("UPSTREAM_ERROR", `${request.schemaName}: the model's output didn't match the schema.`, { details: { issues: result.error.issues.slice(0, 5) }, retryable: true });
    }
    return { object: result.data, model: response.model, usage: usageOf(response) };
  }

  private async send(request: TextGenerationRequest, format?: ReturnType<typeof zodOutputFormat>) {
    const model = request.model ?? this.model;
    const effort = request.effort && supportsEffort(model) ? request.effort : undefined;
    const response = await this.client.beta.messages.create(
      {
        model,
        max_tokens: request.maxOutputTokens ?? 16_000,
        ...(FALLBACK_MODELS.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        ...(request.system
          ? {
              system: [
                {
                  type: "text" as const,
                  text: request.system,
                  ...(request.cacheSystem === false ? {} : { cache_control: { type: "ephemeral" as const } }),
                },
              ],
            }
          : {}),
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        output_config: {
          ...(effort ? { effort } : {}),
          ...(format ? { format } : {}),
        },
      },
      request.signal ? { signal: request.signal } : undefined,
    );

    if (response.stop_reason === "refusal") {
      throw new AppError("UPSTREAM_ERROR", "The model declined this request.", { details: { stopDetails: response.stop_details }, retryable: false });
    }
    if (response.stop_reason === "max_tokens") {
      throw new AppError("UPSTREAM_ERROR", "The model ran out of output tokens before finishing.", { details: { maxTokens: request.maxOutputTokens }, retryable: false });
    }
    return response;
  }
}

type BetaMessage = Anthropic.Beta.BetaMessage;

function textOf(response: BetaMessage): string {
  return response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}

function usageOf(response: BetaMessage): TokenUsage {
  // Cached tokens are billed separately from input_tokens; count them so the logged total is the real one.
  const cached = (response.usage.cache_creation_input_tokens ?? 0) + (response.usage.cache_read_input_tokens ?? 0);
  return { inputTokens: response.usage.input_tokens + cached, outputTokens: response.usage.output_tokens };
}
