import { AnthropicTextProvider } from "./anthropic";
import { AiBalanceEmptyError } from "./balance";
import type { SpendBudget } from "./budget";
import { FallbackTextProvider } from "./fallback";
import { GeminiTextProvider } from "./gemini";
import { OpenRouterTextProvider } from "./openrouter";
import type { TextProvider } from "./types";

/** The Claude model for background work: labeling, radar ratings, sub-niche names. */
export const BACKGROUND_MODEL = "claude-haiku-5-5";

/**
 * Claude Haiku 5.5 first when there's a key, within the background share of
 * the month's budget, then the free models. Haiku is cheap enough
 * (~$0.10/$0.50 per million tokens) that the share labels thousands of
 * channels a month; past it the free chain carries on.
 */
export function labelingProvider(config: {
  NICHE_LABEL_PROVIDER: "auto" | "gemini" | "openrouter" | "anthropic" | "rules";
  ANTHROPIC_API_KEY?: string | undefined;
  GEMINI_API_KEY?: string | undefined;
  GEMINI_MODEL: string;
  OPENROUTER_API_KEY?: string | undefined;
  OPENROUTER_MODELS?: string | undefined;
}, budget?: SpendBudget): TextProvider | null {
  const claude = () => backgroundClaude(config, budget);
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

/** Claude alone for background work, or null without a key; fast enough to run while someone waits. */
export function backgroundClaude(config: { ANTHROPIC_API_KEY?: string | undefined }, budget?: SpendBudget): TextProvider | null {
  if (!config.ANTHROPIC_API_KEY) return null;
  return new AnthropicTextProvider({ apiKey: config.ANTHROPIC_API_KEY, model: BACKGROUND_MODEL, ...(budget ? { budget } : {}) });
}

/**
 * The writer members get. Side by side on the live prompt, Haiku held length
 * and a creator's voice better than Sonnet; Haiku 5.5 is a tenth of 4.5's
 * price, so a script costs well under a cent. Overridden by SCRIPT_MODEL.
 */
export const DEFAULT_SCRIPT_MODEL = "claude-haiku-5-5";
/** The writer for Expert and the owner. Haiku 5.5 for now, the same as Pro. */
export const PREMIUM_SCRIPT_MODEL = "claude-haiku-5-5";

/**
 * The writer behind the Shorts script tool.
 *
 * Scripts are the one thing here worth paying for: they cost eight credits,
 * people judge the product on them, and the free models' thin knowledge of a
 * niche is exactly what had them inventing details to fill the gap.
 *
 * Order is deliberate. Claude first when there's a key, because it follows the
 * layout and the honesty rules far better than anything free. Then a paid
 * OpenRouter model if one is named. Then the free chain, so an outage degrades
 * to a worse script rather than no script at all. A spent balance is different:
 * that pauses the writer (and emails the owner) instead.
 */
export function scriptProvider(config: {
  SCRIPT_MODEL?: string | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
  GEMINI_API_KEY?: string | undefined;
  GEMINI_MODEL: string;
  OPENROUTER_API_KEY?: string | undefined;
  OPENROUTER_MODELS?: string | undefined;
}, options: { premium?: boolean; claude?: boolean; budget?: SpendBudget } = {}): TextProvider | null {
  const chain: TextProvider[] = [];
  const named = config.SCRIPT_MODEL?.trim();
  // Pro writes without Claude: Gemini first, then the OpenRouter models.
  const useClaude = options.claude !== false;

  if (useClaude && config.ANTHROPIC_API_KEY) {
    // A Claude id in SCRIPT_MODEL picks the standard model; anything else is meant for OpenRouter.
    const model = options.premium ? PREMIUM_SCRIPT_MODEL : named?.startsWith("claude-") ? named : DEFAULT_SCRIPT_MODEL;
    chain.push(new AnthropicTextProvider({ apiKey: config.ANTHROPIC_API_KEY, model, ...(options.budget ? { budget: options.budget } : {}) }));
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
  // A spent Anthropic balance pauses the writer rather than handing members a free model's script.
  return chain.length === 1 ? chain[0]! : new FallbackTextProvider(chain, { stopOn: (error) => error instanceof AiBalanceEmptyError });
}
