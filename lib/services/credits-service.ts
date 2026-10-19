import { AppError, ValidationError } from "@/lib/core/errors";
import type { CreditLedgerRepository } from "@/lib/database/repositories/credit-ledger";
import type { UsageRepository } from "@/lib/database/repositories/usage";

/**
 * Monthly credits: every user gets a fresh allowance at the start of each UTC
 * month, plus any bonus credits granted that month (e.g. referral rewards).
 * On top of that sit extra credits (bought, or added by the owner) that never
 * reset: spending uses the monthly allowance first, then draws them down.
 * Costs roughly track the YouTube quota an action burns, so one user can't
 * drain the shared key.
 */

export const CREDIT_COSTS = {
  /** One search.list (100 units) + ingesting up to 25 channels. */
  discover_channels: 10,
  /** A search that had to dig: up to three search.list calls (300 units). */
  discover_channels_deep: 25,
  /** Channel + uploads + Shorts playlist + video stats. */
  track_channel: 3,
  /** Video + channel + recent uploads for the baseline. */
  analyze_video: 2,
  /** Niche Finder fresh research: one search + batched stats (only charged when YouTube is called). */
  niche_research: 5,
  /**
   * A Short script: the niche's outliers, a few transcripts read from YouTube,
   * and a long generation. The most expensive thing a person can ask for, and
   * the only one that spends an AI request rather than API quota.
   */
  write_script: 8,
  /** Six ideas for a niche: one model call, and much less output than a script. */
  find_ideas: 3,
} as const;

export type CreditAction = keyof typeof CREDIT_COSTS;

export interface CreditStatus {
  /** Monthly credits used this month (spending covered by extra credits isn't counted). */
  used: number;
  /** Monthly allowance plus bonus credits granted this month, plus extra credits. */
  limit: number;
  remaining: number;
  /** Bonus credits included in `limit`. */
  bonus: number;
  /** This month's allowance plus bonus, without extra credits. */
  monthly: number;
  /** Credits that don't reset (bought or added by the owner), included in `limit`. */
  extra: number;
  resetsAt: string;
}

/** At or below this many credits left, users are nudged to top up. */
export const LOW_CREDITS_THRESHOLD = 25;

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function startOfNextUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export class CreditsService {
  constructor(
    private readonly usage: Pick<UsageRepository, "creditsSpentSince" | "record" | "hasEventSince">,
    private readonly monthlyCredits: number,
    /** Per-user allowance override (null = default). */
    private readonly limitFor?: (userId: string) => Promise<number | null>,
    /** Bonus credits granted to a user since a time. */
    private readonly bonusSince?: (userId: string, since: Date) => Promise<number>,
    /** Extra credits that don't reset. */
    private readonly ledger?: Pick<CreditLedgerRepository, "balance" | "spentSince" | "add">,
  ) {}

  async status(userId: string, now: Date = new Date()): Promise<CreditStatus> {
    const monthStart = startOfUtcMonth(now);
    const [spent, override, bonus, spentFromExtra, balance] = await Promise.all([
      this.usage.creditsSpentSince(userId, monthStart),
      this.limitFor?.(userId) ?? null,
      this.bonusSince ? this.bonusSince(userId, monthStart).catch(() => 0) : 0,
      this.ledger?.spentSince(userId, monthStart) ?? 0,
      this.ledger?.balance(userId) ?? 0,
    ]);
    const allowance = override ?? this.monthlyCredits;
    // Restricted accounts (allowance 0) don't get to spend bonus or extra credits either.
    const monthly = allowance === 0 ? 0 : allowance + bonus;
    const extra = allowance === 0 ? 0 : Math.max(balance, 0);
    const used = Math.max(spent - spentFromExtra, 0);
    return {
      used,
      limit: monthly + extra,
      remaining: Math.max(monthly - used, 0) + extra,
      bonus: allowance === 0 ? 0 : bonus,
      monthly,
      extra,
      resetsAt: startOfNextUtcMonth(now).toISOString(),
    };
  }

  /** Throw INSUFFICIENT_CREDITS before starting work the user can't afford. */
  async assertAvailable(userId: string, action: CreditAction, now: Date = new Date()): Promise<CreditStatus> {
    const status = await this.status(userId, now);
    if (status.remaining < CREDIT_COSTS[action]) {
      throw new AppError(
        "INSUFFICIENT_CREDITS",
        `This needs ${CREDIT_COSTS[action]} credits and you have ${status.remaining} left. Buy more credits, wait for the monthly reset on the 1st (UTC), or invite friends to earn bonus credits.`,
        { details: { ...status, cost: CREDIT_COSTS[action] } },
      );
    }
    return status;
  }

  /**
   * Record a completed action. With `resourceId`, repeating the same action on the
   * same resource the same day is free (e.g. reloading an analyzed video).
   */
  async charge(userId: string, action: CreditAction, resourceId?: string, now: Date = new Date()): Promise<{ charged: number }> {
    const eventType = `credits.${action}`;
    if (resourceId && (await this.usage.hasEventSince(userId, eventType, resourceId, startOfUtcDay(now)))) {
      return { charged: 0 };
    }
    const cost = CREDIT_COSTS[action];
    // Whatever the monthly allowance can't cover comes out of extra credits.
    let fromExtra = 0;
    if (this.ledger) {
      const status = await this.status(userId, now);
      fromExtra = Math.min(Math.max(cost - Math.max(status.monthly - status.used, 0), 0), status.extra);
    }
    await this.usage.record({
      event_type: eventType,
      user_id: userId,
      credits_cost: cost,
      resource_type: action,
      resource_id: resourceId ?? null,
      occurred_at: now.toISOString(),
    });
    if (fromExtra > 0) {
      await this.ledger!.add({ user_id: userId, amount: -fromExtra, kind: "spend", note: action, created_at: now.toISOString() });
    }
    return { charged: cost };
  }

  /**
   * Owner adds (positive) or removes (negative) extra credits. Removing can't
   * take someone below zero: lower their monthly allowance for that instead.
   */
  async adjust(userId: string, amount: number, note: string | null, actorId: string): Promise<{ extra: number }> {
    if (!this.ledger) throw new AppError("CONFIG_ERROR", "Extra credits aren't set up.");
    if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1_000_000) {
      throw new ValidationError("Enter a whole number of credits to add (or negative to remove).");
    }
    const balance = Math.max(await this.ledger.balance(userId), 0);
    if (balance + amount < 0) {
      throw new ValidationError(`They only have ${balance} extra credits to remove. To give them fewer each month, lower their monthly credits instead.`);
    }
    await this.ledger.add({ user_id: userId, amount, kind: "admin", note: note?.trim().slice(0, 200) || null, actor_id: actorId });
    return { extra: balance + amount };
  }

  /** Credits bought through Stripe. Safe to call again for the same session: it only counts once. */
  async addPurchase(userId: string, credits: number, stripeSessionId: string, note: string): Promise<boolean> {
    if (!this.ledger) throw new AppError("CONFIG_ERROR", "Extra credits aren't set up.");
    const row = await this.ledger.add({ user_id: userId, amount: credits, kind: "purchase", note, stripe_session_id: stripeSessionId });
    return row !== null;
  }

  /** Whether charging for this resource today would be free (already paid). */
  async alreadyPaid(userId: string, action: CreditAction, resourceId: string, now: Date = new Date()): Promise<boolean> {
    return this.usage.hasEventSince(userId, `credits.${action}`, resourceId, startOfUtcDay(now));
  }
}
