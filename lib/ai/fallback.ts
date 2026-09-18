import type { z } from "zod";
import { createLogger } from "@/lib/core/logger";
import type { TextGenerationRequest, TextGenerationResult, TextProvider, TokenUsage } from "./types";

const log = createLogger({ module: "ai.fallback" });

/**
 * Tries providers in order and returns the first answer, so a rate-limited
 * free tier hands the request to the next one instead of failing it.
 */
export class FallbackTextProvider implements TextProvider {
  readonly name: string;

  constructor(private readonly providers: TextProvider[]) {
    if (providers.length === 0) throw new Error("FallbackTextProvider needs at least one provider");
    this.name = providers.map((p) => p.name).join("+");
  }

  generateText(request: TextGenerationRequest): Promise<TextGenerationResult> {
    return this.first((provider) => provider.generateText(request));
  }

  generateObject<T extends z.ZodType>(
    request: TextGenerationRequest & { schema: T; schemaName: string },
  ): Promise<{ object: z.infer<T>; model: string; usage: TokenUsage }> {
    return this.first((provider) => provider.generateObject(request));
  }

  private async first<R>(call: (provider: TextProvider) => Promise<R>): Promise<R> {
    let lastError: unknown;
    for (const [i, provider] of this.providers.entries()) {
      try {
        return await call(provider);
      } catch (error) {
        lastError = error;
        if (i < this.providers.length - 1) log.warn("ai provider failed, trying the next one", { provider: provider.name, error });
      }
    }
    throw lastError;
  }
}
