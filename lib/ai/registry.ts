import { NotImplementedError } from "@/lib/core/errors";
import type { AICapability, AIProviderMap } from "./types";

/**
 * Holds the configured provider per capability. Nothing is registered yet;
 * callers get a clear NOT_IMPLEMENTED error instead of a silent fake.
 */
export class AIProviderRegistry {
  private readonly providers: Partial<AIProviderMap> = {};

  register<C extends AICapability>(capability: C, provider: AIProviderMap[C]): this {
    this.providers[capability] = provider;
    return this;
  }

  has(capability: AICapability): boolean {
    return this.providers[capability] !== undefined;
  }

  get<C extends AICapability>(capability: C): AIProviderMap[C] {
    const provider = this.providers[capability];
    if (!provider) throw new NotImplementedError(`AI ${capability} provider`);
    return provider as AIProviderMap[C];
  }
}

let registry: AIProviderRegistry | undefined;

/** Shared registry. Register concrete providers here once implemented (e.g. based on ANTHROPIC_API_KEY). */
export function getAIProviders(): AIProviderRegistry {
  registry ??= new AIProviderRegistry();
  return registry;
}
