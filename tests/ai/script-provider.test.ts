import { describe, expect, it } from "vitest";
import { DEFAULT_SCRIPT_MODEL, scriptProvider } from "@/lib/ai/select";
import { FallbackTextProvider } from "@/lib/ai/fallback";

/**
 * Scripts are the one paid call here, so which model writes them — and what
 * happens when it can't — is worth pinning down.
 */

const base = { GEMINI_MODEL: "gemini-test" };
const names = (provider: ReturnType<typeof scriptProvider>): string[] =>
  provider instanceof FallbackTextProvider
    ? // The chain isn't public, so read the order off what it reports.
      (provider as unknown as { providers: { name: string }[] }).providers.map((p) => p.name)
    : provider
      ? [provider.name]
      : [];

describe("scriptProvider", () => {
  it("writes with Claude when there's a key, and keeps the free chain behind it", () => {
    const provider = scriptProvider({ ...base, ANTHROPIC_API_KEY: "k", GEMINI_API_KEY: "g", OPENROUTER_API_KEY: "o" });
    expect(names(provider)).toEqual(["anthropic", "gemini", "openrouter"]);
  });

  it("falls back to free models when there's no Claude key", () => {
    const provider = scriptProvider({ ...base, GEMINI_API_KEY: "g", OPENROUTER_API_KEY: "o" });
    expect(names(provider)).toEqual(["gemini", "openrouter"]);
  });

  it("reads a claude id in SCRIPT_MODEL as the Claude model, not an OpenRouter slug", () => {
    const provider = scriptProvider({ ...base, SCRIPT_MODEL: "claude-opus-5", ANTHROPIC_API_KEY: "k", OPENROUTER_API_KEY: "o" });
    // One Anthropic provider and the free OpenRouter chain — no paid OpenRouter call.
    expect(names(provider)).toEqual(["anthropic", "openrouter"]);
  });

  it("sends a non-claude SCRIPT_MODEL to OpenRouter as a paid model", () => {
    const provider = scriptProvider({ ...base, SCRIPT_MODEL: "openai/gpt-5.6-luna-pro", OPENROUTER_API_KEY: "o" });
    expect(names(provider)).toEqual(["openrouter", "openrouter"]);
  });

  it("has a default Claude model, so a key alone is enough to switch over", () => {
    expect(DEFAULT_SCRIPT_MODEL).toMatch(/^claude-/);
    expect(scriptProvider({ ...base, ANTHROPIC_API_KEY: "k" })?.name).toBe("anthropic");
  });

  it("is null when no key is set at all, so the page says so instead of hanging", () => {
    expect(scriptProvider(base)).toBeNull();
  });
});
