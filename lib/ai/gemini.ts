import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { AppError } from "@/lib/core/errors";
import type { TextGenerationRequest, TextGenerationResult, TextProvider, TokenUsage } from "./types";

/** On Google's free tier. gemini-2.5-flash is closed to new keys; override with GEMINI_MODEL. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";

/**
 * Gemini through Google's official SDK. Structured answers use a JSON schema
 * generated from the Zod schema, then validated with Zod again, because the
 * model's JSON mode doesn't enforce every constraint.
 */
export class GeminiTextProvider implements TextProvider {
  readonly name = "gemini";
  private readonly client: Pick<GoogleGenAI, "models">;
  private readonly model: string;

  constructor(options: { apiKey?: string; model?: string; client?: Pick<GoogleGenAI, "models"> } = {}) {
    this.client = options.client ?? new GoogleGenAI(options.apiKey ? { apiKey: options.apiKey } : {});
    this.model = options.model ?? DEFAULT_GEMINI_MODEL;
  }

  async generateText(request: TextGenerationRequest): Promise<TextGenerationResult> {
    const { text, model, usage, finishReason } = await this.send(request);
    return { text, model, usage, stopReason: finishReason };
  }

  async generateObject<T extends z.ZodType>(
    request: TextGenerationRequest & { schema: T; schemaName: string },
  ): Promise<{ object: z.infer<T>; model: string; usage: TokenUsage }> {
    const { text, model, usage } = await this.send(request, jsonSchemaFor(request.schema));
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
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

  private async send(request: TextGenerationRequest, jsonSchema?: unknown) {
    const model = request.model ?? this.model;
    let response;
    try {
      response = await this.client.models.generateContent({
        model,
        contents: request.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        config: {
          ...(request.system ? { systemInstruction: request.system } : {}),
          ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {}),
          ...(jsonSchema ? { responseMimeType: "application/json", responseJsonSchema: jsonSchema } : {}),
          ...(request.signal ? { abortSignal: request.signal } : {}),
        },
      });
    } catch (error) {
      // Rate limits and outages are the caller's cue to stop for this run: surface them as plain errors.
      if (error instanceof ApiError && (error.status === 429 || error.status >= 500)) throw error;
      // A retired model, bad key or bad request is setup, not an answer about these channels.
      if (error instanceof ApiError) {
        throw new AppError("CONFIG_ERROR", `Gemini rejected the request (${error.status}): ${error.message}`, { cause: error, retryable: false });
      }
      throw error;
    }

    const finishReason = response.candidates?.[0]?.finishReason ?? null;
    if (finishReason === "SAFETY" || finishReason === "PROHIBITED_CONTENT" || response.promptFeedback?.blockReason) {
      throw new AppError("UPSTREAM_ERROR", "Gemini declined this request.", { details: { finishReason }, retryable: false });
    }
    if (finishReason === "MAX_TOKENS") {
      throw new AppError("UPSTREAM_ERROR", "Gemini ran out of output tokens before finishing.", { retryable: false });
    }
    return {
      text: response.text ?? "",
      model: response.modelVersion ?? model,
      usage: { inputTokens: response.usageMetadata?.promptTokenCount ?? 0, outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0 },
      finishReason,
    };
  }
}

/** JSON Schema for Gemini's structured output; it rejects the "$schema" keyword. */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}
