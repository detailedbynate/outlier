import { describe, expect, it } from "vitest";
import { ANTHROPIC_SPEND_EVENT, AiBudgetSpentError, DailySpendBudget, costMicros } from "@/lib/ai/budget";
import { AnthropicTextProvider } from "@/lib/ai/anthropic";
import { FallbackTextProvider } from "@/lib/ai/fallback";
import type { TextProvider } from "@/lib/ai/types";

function fakeUsage() {
  const rows: { event_type: string; quantity?: number; occurred_at?: string }[] = [];
  return {
    rows,
    async countSince(eventType: string, since: Date) {
      return rows.filter((r) => r.event_type === eventType && Date.parse(r.occurred_at!) >= since.getTime()).reduce((s, r) => s + (r.quantity ?? 1), 0);
    },
    async record(row: { event_type: string; quantity?: number; occurred_at?: string }) {
      rows.push(row);
      return row as never;
    },
  };
}

describe("costMicros", () => {
  it("prices Haiku 4.5 at $1 in / $5 out per million, with cache writes and reads", () => {
    expect(costMicros("claude-haiku-4-5", { input_tokens: 1_000_000, output_tokens: 0 })).toBe(1_000_000);
    expect(costMicros("claude-haiku-4-5", { input_tokens: 0, output_tokens: 1_000 })).toBe(5_000);
    expect(costMicros("claude-haiku-4-5-20251001", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 10_000 })).toBe(1_000);
  });

  it("prices an unknown model like Opus and never records zero", () => {
    expect(costMicros("claude-new", { input_tokens: 1_000, output_tokens: 0 })).toBe(5_000);
    expect(costMicros("claude-haiku-4-5", { input_tokens: 0, output_tokens: 0 })).toBe(1);
  });
});

describe("DailySpendBudget", () => {
  const now = new Date("2026-10-17T12:00:00Z");

  it("allows spend until the day's cap, then refuses until the next UTC day", async () => {
    const usage = fakeUsage();
    const budget = new DailySpendBudget(usage, 0.3);
    await budget.check(now);
    usage.rows.push({ event_type: ANTHROPIC_SPEND_EVENT, quantity: 300_000, occurred_at: now.toISOString() });
    await expect(budget.check(now)).rejects.toBeInstanceOf(AiBudgetSpentError);
    await budget.check(new Date("2026-10-18T00:00:01Z"));
  });

  it("records what a response cost", async () => {
    const usage = fakeUsage();
    await new DailySpendBudget(usage, 0.3).record("claude-haiku-4-5", { input_tokens: 2_000, output_tokens: 1_000 }, now);
    expect(usage.rows).toEqual([expect.objectContaining({ event_type: ANTHROPIC_SPEND_EVENT, quantity: 7_000 })]);
  });

  it("sends a capped script to the next model instead of calling Claude", async () => {
    const usage = fakeUsage();
    usage.rows.push({ event_type: ANTHROPIC_SPEND_EVENT, quantity: 1_000_000, occurred_at: new Date().toISOString() });
    let called = false;
    const client = { beta: { messages: { create: async () => ((called = true), {}) } } };
    const claude = new AnthropicTextProvider({ client: client as never, budget: new DailySpendBudget(usage, 0.3) });
    const free: TextProvider = {
      name: "free",
      generateText: async () => ({ text: "free script", model: "free", usage: { inputTokens: 0, outputTokens: 0 }, stopReason: "end_turn" }),
      generateObject: async () => {
        throw new Error("unused");
      },
    };
    const result = await new FallbackTextProvider([claude, free]).generateText({ messages: [{ role: "user", content: "hi" }] });
    expect(result.text).toBe("free script");
    expect(called).toBe(false);
  });
});
