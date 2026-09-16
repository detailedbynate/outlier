import { AnthropicTextProvider } from "./anthropic";
import { GeminiTextProvider } from "./gemini";
import type { TextProvider } from "./types";

/** Free Gemini first, Claude when chosen or when it's the only key, rules only otherwise. */
export function labelingProvider(config: {
  NICHE_LABEL_PROVIDER: "auto" | "gemini" | "anthropic" | "rules";
  GEMINI_API_KEY?: string | undefined;
  GEMINI_MODEL: string;
  ANTHROPIC_API_KEY?: string | undefined;
  NICHE_LABEL_MODEL: string;
}): TextProvider | null {
  const gemini = () => (config.GEMINI_API_KEY ? new GeminiTextProvider({ apiKey: config.GEMINI_API_KEY, model: config.GEMINI_MODEL }) : null);
  const claude = () => (config.ANTHROPIC_API_KEY ? new AnthropicTextProvider({ apiKey: config.ANTHROPIC_API_KEY, model: config.NICHE_LABEL_MODEL }) : null);
  switch (config.NICHE_LABEL_PROVIDER) {
    case "rules":
      return null;
    case "gemini":
      return gemini();
    case "anthropic":
      return claude();
    default:
      return gemini() ?? claude();
  }
}
