import { AppError } from "@/lib/core/errors";
import { createLogger } from "@/lib/core/logger";
import type { UsageRepository } from "@/lib/database/repositories/usage";

const log = createLogger({ module: "ai.budget" });

/** usage_events type for the script writer's Claude spend; quantity is in millionths of a dollar. */
export const ANTHROPIC_SPEND_EVENT = "ai.anthropic_spend";

/** usage_events type for Claude spend by background jobs (labeling, radar, naming); same units. */
export const ANTHROPIC_BACKGROUND_SPEND_EVENT = "ai.anthropic_background_spend";

/** $ per million tokens: [input, output]. Cache writes bill 1.25× input, reads 0.1×. */
const PRICES: Record<string, [number, number]> = {
  "claude-haiku-4-5": [1, 5],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5": [2, 10],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5": [5, 25],
  "claude-opus-5-5": [4, 20],
};
/** Haiku 5.5 bills a prompt over 100K tokens at a second, higher rate card. */
const LONG_PROMPT_PRICES: Record<string, [number, number]> = { "claude-haiku-5-5": [0.5, 2.5] };
const LONG_PROMPT_TOKENS = 100_000;
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
  const prompt = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  const long = key && prompt > LONG_PROMPT_TOKENS ? LONG_PROMPT_PRICES[key] : undefined;
  const [input, output] = long ?? (key ? PRICES[key]! : UNKNOWN_PRICE);
  const dollarsPerMillion =
    usage.input_tokens * input +
    (usage.cache_creation_input_tokens ?? 0) * input * 1.25 +
    (usage.cache_read_input_tokens ?? 0) * input * 0.1 +
    usage.output_tokens * output;
  // usage_events.quantity must be positive.
  return Math.max(1, Math.ceil(dollarsPerMillion));
}

/**
 * The Claude budget is used up for now. An ordinary failure, not a spent
 * balance: a fallback chain moves on to the free models instead of pausing.
 */
export class AiBudgetSpentError extends AppError {
  constructor(message = "This month's Claude budget is used up.") {
    super("UPSTREAM_ERROR", message, { retryable: false });
  }
}

export interface SpendBudget {
  /** Throws AiBudgetSpentError when the allowance is gone. */
  check(now?: Date): Promise<void>;
  record(model: string, usage: ClaudeUsage, now?: Date): Promise<void>;
}

/**
 * A monthly cap on Claude spend, matched to what's prepaid for the month, so
 * the balance never runs dry mid-month. Counted from usage_events per UTC
 * calendar month; a few calls in flight at once can go slightly over, which
 * is fine for a soft cap.
 *
 * The script writer can use the whole month. Background jobs pass `shareUsd`:
 * they stop at that share of the month, and at an even slice of it per day,
 * so an hourly job can't spend the month in a night and leave scripts short.
 */
export class MonthlySpendBudget implements SpendBudget {
  private readonly event: string;

  constructor(
    private readonly usage: Pick<UsageRepository, "countSince" | "record">,
    private readonly monthlyUsd: number,
    private readonly options: { shareUsd?: number } = {},
  ) {
    this.event = options.shareUsd === undefined ? ANTHROPIC_SPEND_EVENT : ANTHROPIC_BACKGROUND_SPEND_EVENT;
  }

  async check(now: Date = new Date()): Promise<void> {
    const month = startOfUtcMonth(now);
    const [scripts, background] = await Promise.all([
      this.usage.countSince(ANTHROPIC_SPEND_EVENT, month),
      this.usage.countSince(ANTHROPIC_BACKGROUND_SPEND_EVENT, month),
    ]);
    if (scripts + background >= this.monthlyUsd * 1_000_000) throw new AiBudgetSpentError();

    const share = this.options.shareUsd;
    if (share === undefined) return;
    if (background >= share * 1_000_000) throw new AiBudgetSpentError("This month's Claude share for background jobs is used up.");
    const today = await this.usage.countSince(ANTHROPIC_BACKGROUND_SPEND_EVENT, startOfUtcDay(now));
    if (today >= (share / daysInUtcMonth(now)) * 1_000_000) throw new AiBudgetSpentError("Today's Claude share for background jobs is used up.");
  }

  async record(model: string, usage: ClaudeUsage, now: Date = new Date()): Promise<void> {
    try {
      await this.usage.record({ event_type: this.event, quantity: costMicros(model, usage), resource_id: model, occurred_at: now.toISOString() });
    } catch (error) {
      // The answer already came back; losing one line of accounting beats failing the request.
      log.warn("could not record claude spend", { model, error });
    }
  }
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function daysInUtcMonth(now: Date): number {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
}
