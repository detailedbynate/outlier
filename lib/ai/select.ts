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

/**
 * The writer behind the Shorts script tool.
 *
 * Scripts are the one thing worth paying for: they cost eight credits, people
 * judge the product on them, and the free models' weak knowledge of a niche is
 * exactly what made the early ones read as invented. SCRIPT_MODEL names a paid
 * OpenRouter model to write them.
 *
 * The free chain stays behind it, so an unfunded account, a spending cap or an
 * outage degrades to a worse script instead of no script.
 */
export function scriptProvider(config: {
  SCRIPT_MODEL?: string | undefined;
  GEMINI_API_KEY?: string | undefined;
  GEMINI_MODEL: string;
  OPENROUTER_API_KEY?: string | undefined;
  OPENROUTER_MODELS?: string | undefined;
}): TextProvider | null {
  const chain: TextProvider[] = [];
  const paid = config.SCRIPT_MODEL?.trim();
  if (paid && config.OPENROUTER_API_KEY) {
    chain.push(new OpenRouterTextProvider({ apiKey: config.OPENROUTER_API_KEY, models: [paid] }));
  }
  if (config.GEMINI_API_KEY) chain.push(new GeminiTextProvider({ apiKey: config.GEMINI_API_KEY, model: config.GEMINI_MODEL }));
  if (config.OPENROUTER_API_KEY) {
    chain.push(
      new OpenRouterTextProvider({
        apiKey: config.OPENROUTER_API_KEY,
        models: (config.OPENROUTER_MODELS ?? "")
          .split(",")
          .map((m) => m.trim())
          .filter(Boolean),
      }),
    );
  }
  if (chain.length === 0) return null;
  return chain.length === 1 ? chain[0]! : new FallbackTextProvider(chain);
}
