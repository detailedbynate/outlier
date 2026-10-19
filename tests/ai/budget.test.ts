import { describe, expect, it } from "vitest";
import { ANTHROPIC_BACKGROUND_SPEND_EVENT, ANTHROPIC_SPEND_EVENT, AiBudgetSpentError, MonthlySpendBudget, costMicros } from "@/lib/ai/budget";
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

  it("prices Haiku 5.5 at $0.10 / $0.50, and a prompt over 100K tokens at the higher card", () => {
    expect(costMicros("claude-haiku-5-5", { input_tokens: 100_000, output_tokens: 0 })).toBe(10_000);
    expect(costMicros("claude-haiku-5-5", { input_tokens: 0, output_tokens: 1_000 })).toBe(500);
    expect(costMicros("claude-haiku-5-5", { input_tokens: 200_000, output_tokens: 1_000 })).toBe(100_000 + 2_500);
  });

  it("prices an unknown model like Opus and never records zero", () => {
    expect(costMicros("claude-new", { input_tokens: 1_000, output_tokens: 0 })).toBe(5_000);
    expect(costMicros("claude-haiku-4-5", { input_tokens: 0, output_tokens: 0 })).toBe(1);
  });
});

describe("MonthlySpendBudget", () => {
  const now = new Date("2026-10-17T12:00:00Z");
  const spend = (event: string, dollars: number, at: Date = now) => ({ event_type: event, quantity: dollars * 1_000_000, occurred_at: at.toISOString() });

  it("lets scripts use the month's budget, then refuses until the 1st", async () => {
    const usage = fakeUsage();
    const budget = new MonthlySpendBudget(usage, 5);
    usage.rows.push(spend(ANTHROPIC_SPEND_EVENT, 3, new Date("2026-10-02T00:00:00Z")));
    await budget.check(now);
    usage.rows.push(spend(ANTHROPIC_BACKGROUND_SPEND_EVENT, 2));
    await expect(budget.check(now)).rejects.toBeInstanceOf(AiBudgetSpentError);
    await budget.check(new Date("2026-11-01T00:00:01Z"));
  });

  it("holds background jobs to their share, paced per day", async () => {
    const usage = fakeUsage();
    // A day's slice of a $3.10 share in October is $0.10.
    const background = new MonthlySpendBudget(usage, 5, { shareUsd: 3.1 });
    usage.rows.push(spend(ANTHROPIC_BACKGROUND_SPEND_EVENT, 0.09));
    await background.check(now);
    usage.rows.push(spend(ANTHROPIC_BACKGROUND_SPEND_EVENT, 0.01));
    await expect(background.check(now)).rejects.toBeInstanceOf(AiBudgetSpentError);
    const tomorrow = new Date("2026-10-18T00:00:01Z");
    await background.check(tomorrow);
    usage.rows.push(spend(ANTHROPIC_BACKGROUND_SPEND_EVENT, 3, new Date("2026-10-05T00:00:00Z")));
    await expect(background.check(tomorrow)).rejects.toThrow("share for background jobs");
    // Scripts still have what's left of the month.
    await new MonthlySpendBudget(usage, 5).check(tomorrow);
  });

  it("records scripts and background jobs under their own event", async () => {
    const usage = fakeUsage();
    await new MonthlySpendBudget(usage, 5).record("claude-haiku-4-5", { input_tokens: 2_000, output_tokens: 1_000 }, now);
    await new MonthlySpendBudget(usage, 5, { shareUsd: 2 }).record("claude-haiku-5-5", { input_tokens: 2_000, output_tokens: 1_000 }, now);
    expect(usage.rows).toEqual([
      expect.objectContaining({ event_type: ANTHROPIC_SPEND_EVENT, quantity: 7_000 }),
      expect.objectContaining({ event_type: ANTHROPIC_BACKGROUND_SPEND_EVENT, quantity: 700 }),
    ]);
  });

  it("sends a capped script to the next model instead of calling Claude", async () => {
    const usage = fakeUsage();
    usage.rows.push({ event_type: ANTHROPIC_SPEND_EVENT, quantity: 5_000_000, occurred_at: new Date().toISOString() });
    let called = false;
    const client = { beta: { messages: { create: async () => ((called = true), {}) } } };
    const claude = new AnthropicTextProvider({ client: client as never, budget: new MonthlySpendBudget(usage, 5) });
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
