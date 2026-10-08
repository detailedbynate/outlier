import { isEntitled, planOrFree, type Plan, type PlanId } from "@/lib/billing/plans";
import { TRIAL_STATUS, type Trial } from "@/lib/billing/trial";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { SubscriptionRepository } from "@/lib/database/repositories/subscriptions";
import type { SubscriptionRow } from "@/types/database";

/**
 * What plan someone is on.
 *
 * Stripe is the source of truth; this is the copy Outlier reads on every credit
 * check, so it has to be cheap and it has to fail safe. If the row is missing,
 * unreadable, or says the subscription lapsed, the answer is the free plan —
 * never a locked-out account, and never a paid allowance nobody is paying for.
 *
 * A cancelled-but-not-yet-expired subscription keeps its plan until the period
 * they paid for actually ends.
 */

export interface SubscriptionState {
  plan: Plan;
  status: string;
  /** They cancelled; the plan stops at `currentPeriodEnd`. */
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
  /** True once they've ever had a paid plan, so the UI can say "manage" not "upgrade". */
  hasBilling: boolean;
  /** A hand-given free trial, running or ended (see lib/billing/trial). Null for everyone else. */
  trial: Trial | null;
}

/** How long a looked-up plan is reused before asking the database again. */
const CACHE_MS = 60_000;

export class SubscriptionService {
  private readonly log: Logger;
  private readonly cache = new Map<string, { at: number; state: SubscriptionState }>();
  private readonly listeners: ((userId: string) => void)[] = [];

  constructor(
    private readonly repository: SubscriptionRepository,
    private readonly now: () => number = () => Date.now(),
    log: Logger = createLogger({ module: "services.subscriptions" }),
  ) {
    this.log = log;
  }

  /** The plan a row entitles its user to right now. */
  private stateOf(row: SubscriptionRow | null): SubscriptionState {
    const free = planOrFree(null);
    if (!row) {
      return { plan: free, status: "inactive", cancelAtPeriodEnd: false, currentPeriodEnd: null, stripeCustomerId: null, hasBilling: false, trial: null };
    }
    const expired = row.current_period_end !== null && Date.parse(row.current_period_end) < this.now();
    const isTrial = row.status === TRIAL_STATUS && row.current_period_end !== null && (row.plan === "pro" || row.plan === "expert");
    // A trial is entitled until its end date, then it's Free like any lapsed plan.
    const entitled = (isEntitled(row.status) || isTrial) && !expired;
    return {
      plan: entitled ? planOrFree(row.plan) : free,
      status: row.status,
      cancelAtPeriodEnd: row.cancel_at_period_end,
      currentPeriodEnd: row.current_period_end,
      stripeCustomerId: row.stripe_customer_id,
      hasBilling: row.stripe_customer_id !== null,
      trial: isTrial ? { planId: row.plan as Trial["planId"], endsAt: row.current_period_end!, startedAt: row.updated_at ?? null } : null,
    };
  }

  async stateFor(userId: string): Promise<SubscriptionState> {
    const cached = this.cache.get(userId);
    if (cached && this.now() - cached.at < CACHE_MS) return cached.state;
    let state: SubscriptionState;
    try {
      state = this.stateOf(await this.repository.findByUserId(userId));
    } catch (error) {
      // A billing lookup must never take the app down: fall back to the free plan.
      this.log.error("subscription lookup failed, treating as free", { userId, error });
      state = this.stateOf(null);
    }
    this.cache.set(userId, { at: this.now(), state });
    return state;
  }

  /** The monthly credit allowance this user's plan grants. */
  async monthlyCreditsFor(userId: string): Promise<number> {
    return (await this.stateFor(userId)).plan.monthlyCredits;
  }

  /** Write what Stripe just told us, and stop serving the cached plan. */
  async apply(input: {
    userId: string;
    plan: PlanId;
    status: string;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  }): Promise<void> {
    await this.repository.upsert({
      user_id: input.userId,
      plan: input.plan,
      status: input.status,
      stripe_customer_id: input.stripeCustomerId,
      stripe_subscription_id: input.stripeSubscriptionId,
      current_period_end: input.currentPeriodEnd,
      cancel_at_period_end: input.cancelAtPeriodEnd,
    });
    this.invalidate(input.userId);
    this.log.info("subscription updated", { userId: input.userId, plan: input.plan, status: input.status });
    for (const listener of this.listeners) listener(input.userId);
  }

  /** Be told whenever someone's plan is written (Stripe, a trial, an admin). Listeners must not throw. */
  onChange(listener: (userId: string) => void): void {
    this.listeners.push(listener);
  }

  invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  /** The user behind a Stripe customer, for webhook events that only name the customer. */
  userIdForCustomer(customerId: string): Promise<string | null> {
    return this.repository.findByCustomerId(customerId).then((row) => row?.user_id ?? null);
  }
}
