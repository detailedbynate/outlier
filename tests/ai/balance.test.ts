import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicTextProvider } from "@/lib/ai/anthropic";
import { AiBalanceEmptyError, isCreditBalanceError, onBalanceEmpty, reportBalanceEmpty, resetBalanceAlert } from "@/lib/ai/balance";
import { FallbackTextProvider } from "@/lib/ai/fallback";
import type { TextProvider } from "@/lib/ai/types";

const spent = Object.assign(new Error("Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."), {
  status: 400,
});

function textProvider(name: string, generateText: TextProvider["generateText"]): TextProvider {
  return { name, generateText, generateObject: vi.fn() } as unknown as TextProvider;
}

afterEach(() => resetBalanceAlert());

describe("empty Anthropic balance", () => {
  it("recognizes Anthropic's credit balance error and nothing else", () => {
    expect(isCreditBalanceError(spent)).toBe(true);
    expect(isCreditBalanceError(Object.assign(new Error("Overloaded"), { status: 529 }))).toBe(false);
    expect(isCreditBalanceError(Object.assign(new Error("max_tokens too large"), { status: 400 }))).toBe(false);
    expect(isCreditBalanceError(null)).toBe(false);
  });

  it("turns it into a paused-writer error and tells the owner", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    onBalanceEmpty(notify);
    const client = { beta: { messages: { create: vi.fn().mockRejectedValue(spent) } } } as unknown as Anthropic;
    const error = await new AnthropicTextProvider({ client }).generateText({ messages: [{ role: "user", content: "x" }] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiBalanceEmptyError);
    expect((error as AiBalanceEmptyError).expose).toBe(true);
    expect((error as Error).message).toMatch(/paused/);
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/credit balance/));
  });

  it("alerts at most once every six hours", () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    onBalanceEmpty(notify);
    reportBalanceEmpty("a", 1_000);
    reportBalanceEmpty("b", 1_000 + 60 * 60 * 1000);
    reportBalanceEmpty("c", 1_000 + 7 * 60 * 60 * 1000);
    expect(notify.mock.calls.map((c) => c[0])).toEqual(["a", "c"]);
  });

  it("stops a chain that asks it to, and falls through one that doesn't", async () => {
    const free = vi.fn().mockResolvedValue({ text: "free", model: "free", usage: { inputTokens: 0, outputTokens: 0 }, stopReason: null });
    const claude = textProvider("anthropic", () => Promise.reject(new AiBalanceEmptyError()));
    const request = { messages: [{ role: "user" as const, content: "x" }] };

    const scripts = new FallbackTextProvider([claude, textProvider("free", free)], { stopOn: (e) => e instanceof AiBalanceEmptyError });
    await expect(scripts.generateText(request)).rejects.toBeInstanceOf(AiBalanceEmptyError);
    expect(free).not.toHaveBeenCalled();

    const labeling = new FallbackTextProvider([claude, textProvider("free", free)]);
    await expect(labeling.generateText(request)).resolves.toMatchObject({ text: "free" });
  });
});
