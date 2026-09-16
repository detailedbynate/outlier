import { AppError } from "@/lib/core/errors";
import type { UsageRepository } from "@/lib/database/repositories/usage";

/**
 * Monthly credits: every user gets a fresh allowance at the start of each UTC
 * month, plus any bonus credits granted that month (e.g. referral rewards).
 * Costs roughly track the YouTube quota an action burns, so one user can't
 * drain the shared key. Paid plans later only need a different allowance.
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
} as const;

export type CreditAction = keyof typeof CREDIT_COSTS;

export interface CreditStatus {
  used: number;
  /** Monthly allowance plus bonus credits granted this month. */
  limit: number;
  remaining: number;
  /** Bonus credits included in `limit`. */
  bonus: number;
  resetsAt: string;
}

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
  ) {}

  async status(userId: string, now: Date = new Date()): Promise<CreditStatus> {
    const monthStart = startOfUtcMonth(now);
    const [used, override, bonus] = await Promise.all([
      this.usage.creditsSpentSince(userId, monthStart),
      this.limitFor?.(userId) ?? null,
      this.bonusSince ? this.bonusSince(userId, monthStart).catch(() => 0) : 0,
    ]);
    const allowance = override ?? this.monthlyCredits;
    // Restricted accounts (allowance 0) don't get to spend bonus credits either.
    const limit = allowance === 0 ? 0 : allowance + bonus;
    return {
      used,
      limit,
      remaining: Math.max(limit - used, 0),
      bonus: allowance === 0 ? 0 : bonus,
      resetsAt: startOfNextUtcMonth(now).toISOString(),
    };
  }

  /** Throw INSUFFICIENT_CREDITS before starting work the user can't afford. */
  async assertAvailable(userId: string, action: CreditAction, now: Date = new Date()): Promise<CreditStatus> {
    const status = await this.status(userId, now);
    if (status.remaining < CREDIT_COSTS[action]) {
      throw new AppError(
        "INSUFFICIENT_CREDITS",
        `This needs ${CREDIT_COSTS[action]} credits and you have ${status.remaining} left this month. Credits reset on the 1st (UTC). Invite friends to earn bonus credits.`,
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
    await this.usage.record({
      event_type: eventType,
      user_id: userId,
      credits_cost: CREDIT_COSTS[action],
      resource_type: action,
      resource_id: resourceId ?? null,
      occurred_at: now.toISOString(),
    });
    return { charged: CREDIT_COSTS[action] };
  }

  /** Whether charging for this resource today would be free (already paid). */
  async alreadyPaid(userId: string, action: CreditAction, resourceId: string, now: Date = new Date()): Promise<boolean> {
    return this.usage.hasEventSince(userId, `credits.${action}`, resourceId, startOfUtcDay(now));
  }
}
