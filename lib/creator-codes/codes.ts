/**
 * Creator codes. A creator shares outlier.../?code=NATE; whoever subscribes
 * within 30 days gets money off their first months, and the creator earns a
 * share of what that customer pays. Codes are made by an admin, discounts run
 * as Stripe coupons, and commissions are worked out from paid invoices.
 */

export const CREATOR_CODE_COOKIE = "outlier_code";
/** How long a creator's link is remembered on a visitor's browser. */
export const CREATOR_CODE_COOKIE_MAX_AGE = 30 * 24 * 3600;
/** Letters, digits, - and _: short enough to say out loud in a video. */
export const CREATOR_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{1,19}$/;
/** Subscription metadata key that carries the code to every invoice. */
export const CREATOR_CODE_METADATA = "creatorCode";

export function normalizeCreatorCode(value: string | null | undefined): string | null {
  const code = (value ?? "").trim().toLowerCase();
  return CREATOR_CODE_PATTERN.test(code) ? code : null;
}

/** How a code reads on the page and in Stripe. */
export function displayCode(code: string): string {
  return code.toUpperCase();
}

export function stripeCouponIdFor(code: string): string {
  return `creator-${code}`;
}

/** "20% off your first 2 months". */
export function discountLabel(code: { discount_percent: number; discount_months: number }): string {
  const months = code.discount_months === 1 ? "first month" : `first ${code.discount_months} months`;
  return `${code.discount_percent}% off your ${months}`;
}

export interface CommissionInput {
  /** What the customer paid before tax, in cents. */
  amountCents: number;
  commissionPercent: number;
  commissionMonths: number | null;
  paidAt: Date;
  /** When this customer's first commissioned invoice was paid, if there's been one. */
  firstPaidAt: Date | null;
}

/**
 * The creator's share of one paid invoice, in cents: null when there's nothing
 * to record (a free trial invoice, or past the code's commission window).
 */
export function commissionFor(input: CommissionInput): number | null {
  if (input.amountCents <= 0 || input.commissionPercent <= 0) return null;
  if (input.commissionMonths !== null && input.firstPaidAt) {
    const end = new Date(input.firstPaidAt);
    end.setUTCMonth(end.getUTCMonth() + input.commissionMonths);
    if (input.paidAt >= end) return null;
  }
  return Math.round((input.amountCents * input.commissionPercent) / 100);
}

export interface CreatorCodeStats {
  /** Customers who've paid at least once with the code. */
  customers: number;
  revenueCents: number;
  earnedCents: number;
  paidOutCents: number;
  owedCents: number;
}

export function statsFrom(rows: readonly { stripe_customer_id: string | null; amount_cents: number; commission_cents: number; paid_out_at: string | null }[]): CreatorCodeStats {
  const customers = new Set(rows.map((r) => r.stripe_customer_id ?? "")).size;
  const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((total, r) => total + pick(r), 0);
  const earned = sum((r) => r.commission_cents);
  const paidOut = sum((r) => (r.paid_out_at ? r.commission_cents : 0));
  return { customers, revenueCents: sum((r) => r.amount_cents), earnedCents: earned, paidOutCents: paidOut, owedCents: earned - paidOut };
}
