import { AppError } from "@/lib/core/errors";
import { createLogger } from "@/lib/core/logger";
import type { UsageRepository } from "@/lib/database/repositories/usage";

const log = createLogger({ module: "ai.budget" });

/** usage_events type for Claude spend; quantity is in millionths of a dollar. */
export const ANTHROPIC_SPEND_EVENT = "ai.anthropic_spend";

/** $ per million tokens: [input, output]. Cache writes bill 1.25× input, reads 0.1×. */
const PRICES: Record<string, [number, number]> = {
  "claude-haiku-4-5": [1, 5],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5": [2, 10],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5": [5, 25],
  "claude-opus-5-5": [4, 20],
};
/** Unknown models are priced like Opus, so a guess errs towards stopping early. */
const UNKNOWN_PRICE: [number, number] = [5, 25];

export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** What one response cost, in millionths of a dollar. */
export function costMicros(model: string, usage: ClaudeUsage): number {
  const key = Object.keys(PRICES).find((id) => model === id || model.startsWith(`${id}-`));
  const [input, output] = key ? PRICES[key]! : UNKNOWN_PRICE;
  const dollarsPerMillion =
    usage.input_tokens * input +
    (usage.cache_creation_input_tokens ?? 0) * input * 1.25 +
    (usage.cache_read_input_tokens ?? 0) * input * 0.1 +
    usage.output_tokens * output;
  // usage_events.quantity must be positive.
  return Math.max(1, Math.ceil(dollarsPerMillion));
}

/**
 * Today's Claude allowance is used up. An ordinary failure, not a spent
 * balance: the script writer moves on to the free models for the rest of the
 * day instead of pausing.
 */
export class AiBudgetSpentError extends AppError {
  constructor() {
    super("UPSTREAM_ERROR", "Today's Claude budget is used up.", { retryable: false });
  }
}

export interface SpendBudget {
  /** Throws AiBudgetSpentError when today's allowance is gone. */
  check(now?: Date): Promise<void>;
  record(model: string, usage: ClaudeUsage, now?: Date): Promise<void>;
}

/**
 * A daily cap on Claude spend, so a prepaid top-up lasts weeks instead of
 * going in a burst. Counted from usage_events per UTC day; a few calls in
 * flight at once can go slightly over, which is fine for a soft cap.
 */
export class DailySpendBudget implements SpendBudget {
  constructor(
    private readonly usage: Pick<UsageRepository, "countSince" | "record">,
    private readonly dailyUsd: number,
  ) {}

  async check(now: Date = new Date()): Promise<void> {
    const spent = await this.usage.countSince(ANTHROPIC_SPEND_EVENT, startOfUtcDay(now));
    if (spent >= this.dailyUsd * 1_000_000) throw new AiBudgetSpentError();
  }

  async record(model: string, usage: ClaudeUsage, now: Date = new Date()): Promise<void> {
    try {
      await this.usage.record({ event_type: ANTHROPIC_SPEND_EVENT, quantity: costMicros(model, usage), resource_id: model, occurred_at: now.toISOString() });
    } catch (error) {
      // The answer already came back; losing one line of accounting beats failing the request.
      log.warn("could not record claude spend", { model, error });
    }
  }
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
