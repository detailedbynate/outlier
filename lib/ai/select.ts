import { AnthropicTextProvider } from "./anthropic";
import { FallbackTextProvider } from "./fallback";
import { GeminiTextProvider } from "./gemini";
import { OpenRouterTextProvider } from "./openrouter";
import type { TextProvider } from "./types";

/**
 * Claude (Haiku by default) first when there's a key, then the free models.
 *
 * Free used to go first, but the hourly job gets 40 seconds and the free
 * reasoning models routinely took longer on a batch, so nothing was labeled
 * for days. Haiku answers a batch in seconds for well under a cent.
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
      const chain: TextProvider[] = [claude(), gemini(), openrouter()].filter((p) => p !== null);
      if (chain.length > 1) return new FallbackTextProvider(chain);
      return chain[0] ?? null;
    }
  }
}

/**
 * The writer members get. Side by side on the live prompt, Haiku held length
 * and a creator's voice better than Sonnet at about a third of the price;
 * Sonnet knew a niche a little more deeply. Overridden by SCRIPT_MODEL.
 */
export const DEFAULT_SCRIPT_MODEL = "claude-haiku-4-5";
/** The deeper writer, kept for the owner. */
export const PREMIUM_SCRIPT_MODEL = "claude-sonnet-5";

/**
 * The writer behind the Shorts script tool.
 *
 * Scripts are the one thing here worth paying for: they cost eight credits,
 * people judge the product on them, and the free models' thin knowledge of a
 * niche is exactly what had them inventing details to fill the gap.
 *
 * Order is deliberate. Claude first when there's a key, because it follows the
 * layout and the honesty rules far better than anything free. Then a paid
 * OpenRouter model if one is named. Then the free chain, so a spent balance or
 * an outage degrades to a worse script rather than no script at all.
 */
export function scriptProvider(config: {
  SCRIPT_MODEL?: string | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
  GEMINI_API_KEY?: string | undefined;
  GEMINI_MODEL: string;
  OPENROUTER_API_KEY?: string | undefined;
  OPENROUTER_MODELS?: string | undefined;
}, options: { premium?: boolean } = {}): TextProvider | null {
  const chain: TextProvider[] = [];
  const named = config.SCRIPT_MODEL?.trim();

  if (config.ANTHROPIC_API_KEY) {
    // A Claude id in SCRIPT_MODEL picks the standard model; anything else is meant for OpenRouter.
    const model = options.premium ? PREMIUM_SCRIPT_MODEL : named?.startsWith("claude-") ? named : DEFAULT_SCRIPT_MODEL;
    chain.push(new AnthropicTextProvider({ apiKey: config.ANTHROPIC_API_KEY, model }));
  }
  if (named && !named.startsWith("claude-") && config.OPENROUTER_API_KEY) {
    chain.push(new OpenRouterTextProvider({ apiKey: config.OPENROUTER_API_KEY, models: [named] }));
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
