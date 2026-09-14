import { AppError } from "@/lib/core/errors";
import type { UsageRepository } from "@/lib/database/repositories/usage";

/**
 * Daily credits: every user gets a fresh allowance each UTC day. Costs roughly
 * track the YouTube quota an action burns, so one user can't drain the shared key.
 * Paid plans later only need a different `dailyCredits` per workspace.
 */

export const CREDIT_COSTS = {
  /** search.list (100 units) + ingesting up to 25 channels. */
  discover_channels: 10,
  /** Channel + uploads + Shorts playlist + video stats. */
  track_channel: 3,
  /** Video + channel + recent uploads for the baseline. */
  analyze_video: 2,
} as const;

export type CreditAction = keyof typeof CREDIT_COSTS;

export interface CreditStatus {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
}

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export class CreditsService {
  constructor(
    private readonly usage: Pick<UsageRepository, "creditsSpentSince" | "record" | "hasEventSince">,
    private readonly dailyCredits: number,
  ) {}

  async status(userId: string, now: Date = new Date()): Promise<CreditStatus> {
    const dayStart = startOfUtcDay(now);
    const used = await this.usage.creditsSpentSince(userId, dayStart);
    return {
      used,
      limit: this.dailyCredits,
      remaining: Math.max(this.dailyCredits - used, 0),
      resetsAt: new Date(dayStart.getTime() + 86_400_000).toISOString(),
    };
  }

  /** Throw INSUFFICIENT_CREDITS before starting work the user can't afford. */
  async assertAvailable(userId: string, action: CreditAction, now: Date = new Date()): Promise<CreditStatus> {
    const status = await this.status(userId, now);
    if (status.remaining < CREDIT_COSTS[action]) {
      throw new AppError(
        "INSUFFICIENT_CREDITS",
        `This needs ${CREDIT_COSTS[action]} credits and you have ${status.remaining} left today. Credits reset at midnight UTC.`,
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
