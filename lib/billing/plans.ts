/**
 * Subscription plans. Mostly a plan is one thing: how many credits the user gets
 * each month. Every research tool is on every plan, because credits already
 * price the expensive work.
 *
 * The Shorts Script Writer is the exception, and it is one on purpose: it is the
 * only thing here that costs real money per use on top of credits, so it sits on
 * Pro and above. Anything else gated later belongs in this comment too, because
 * the Terms say out loud which features are plan-specific.
 *
 * Prices are in US cents and Stripe is the seller of record. The price a plan
 * charges lives here, but the Stripe Price it charges against comes from the
 * environment, so test and live keys can point at different products.
 */

export type PlanId = "free" | "pro" | "expert";

export interface Plan {
  id: PlanId;
  name: string;
  /** Monthly credit allowance. Resets on the 1st (UTC), like every allowance. */
  monthlyCredits: number;
  /**
   * What the allowance feels like to use, in plain words. Deliberately not a
   * count of actions: an exact number invites arithmetic, and the small ones
   * make a plan sound worse than it is.
   */
  creditsNote: string;
  /** What they pay each month, in US cents. Zero on the free plan. */
  priceCents: number;
  /**
   * The price this plan goes back to when the launch sale ends. Set only while
   * a plan is discounted; the UI shows it struck through.
   */
  listPriceCents?: number;
  /** Shown as a badge on the plan card. */
  badge?: string;
  blurb: string;
  /** Short lines under the price. The credit allowance is added automatically. */
  features: readonly string[];
}

/** The launch sale ends at the start of this day (UTC), when Pro goes to its list price. */
export const SALE_ENDS_AT = Date.UTC(2026, 9, 1);

export const PLANS: readonly Plan[] = [
  {
    id: "free",
    name: "Free",
    monthlyCredits: 50,
    priceCents: 0,
    blurb: "For trying Outlier on one channel",
    creditsNote: "Enough to explore a niche and see what the tools find",
    features: ["Every research tool", "Shorts Channels, Niche Finder, competitor tracking", "Credits reset on the 1st"],
  },
  {
    id: "pro",
    name: "Pro",
    monthlyCredits: 1_500,
    priceCents: 1_000,
    listPriceCents: 1_500,
    badge: "Most popular",
    blurb: "For creators researching every week",
    creditsNote: "Research most days without watching the meter",
    features: [
      "Everything on Free, plus the Shorts Script Writer",
      "30× the credits of Free",
      "Top up any time — bought credits never expire",
      "Cancel any time",
    ],
  },
  {
    id: "expert",
    name: "Expert",
    monthlyCredits: 5_000,
    priceCents: 3_000,
    blurb: "For studios running several channels",
    creditsNote: "A whole roster's research, every week of the month",
    features: ["Everything on Pro", "Over 3× the credits of Pro", "Room for a whole roster of channels", "Cancel any time"],
  },
];

export const FREE_PLAN = PLANS[0]!;

export function findPlan(id: string | null | undefined): Plan | null {
  return PLANS.find((plan) => plan.id === id) ?? null;
}

/** The plan a user is on, falling back to Free for anyone without a subscription. */
export function planOrFree(id: string | null | undefined): Plan {
  return findPlan(id) ?? FREE_PLAN;
}

/** Paid plans, in the order they're shown. */
export const PAID_PLANS = PLANS.filter((plan) => plan.priceCents > 0);

/** Is this plan's launch price still running? */
export function onSale(plan: Plan, now: Date = new Date()): boolean {
  return plan.listPriceCents !== undefined && now.getTime() < SALE_ENDS_AT;
}

/**
 * Stripe statuses that mean the user is still entitled to their plan. A past-due
 * subscription keeps working while Stripe retries the card, which is kinder than
 * cutting someone off over a card that expired.
 */
const ENTITLED = new Set(["active", "trialing", "past_due"]);

export function isEntitled(status: string | null | undefined): boolean {
  return ENTITLED.has(status ?? "");
}
