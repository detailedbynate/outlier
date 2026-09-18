import { AnthropicTextProvider } from "./anthropic";
import { FallbackTextProvider } from "./fallback";
import { GeminiTextProvider } from "./gemini";
import { OpenRouterTextProvider } from "./openrouter";
import type { TextProvider } from "./types";

/**
 * Free first: Gemini, then OpenRouter's free models when Gemini is rate-limited.
 * Claude when chosen or when it's the only key; rules only otherwise.
 */
export function labelingProvider(config: {
  NICHE_LABEL_PROVIDER: "auto" | "gemini" | "openrouter" | "anthropic" | "rules";
  GEMINI_API_KEY?: string | undefined;
  GEMINI_MODEL: string;
  OPENROUTER_API_KEY?: string | undefined;
  OPENROUTER_MODELS?: string | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
  NICHE_LABEL_MODEL: string;
}): TextProvider | null {
  const gemini = () => (config.GEMINI_API_KEY ? new GeminiTextProvider({ apiKey: config.GEMINI_API_KEY, model: config.GEMINI_MODEL }) : null);
  const openrouter = () =>
    config.OPENROUTER_API_KEY
      ? new OpenRouterTextProvider({
          apiKey: config.OPENROUTER_API_KEY,
          models: (config.OPENROUTER_MODELS ?? "")
            .split(",")
            .map((m) => m.trim())
            .filter(Boolean),
        })
      : null;
  const claude = () => (config.ANTHROPIC_API_KEY ? new AnthropicTextProvider({ apiKey: config.ANTHROPIC_API_KEY, model: config.NICHE_LABEL_MODEL }) : null);
  switch (config.NICHE_LABEL_PROVIDER) {
    case "rules":
      return null;
    case "gemini":
      return gemini();
    case "openrouter":
      return openrouter();
    case "anthropic":
      return claude();
    default: {
      const free = [gemini(), openrouter()].filter((p): p is GeminiTextProvider | OpenRouterTextProvider => p !== null);
      if (free.length > 1) return new FallbackTextProvider(free);
      return free[0] ?? claude();
    }
  }
}
