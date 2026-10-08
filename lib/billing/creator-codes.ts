import "server-only";
import { cookies } from "next/headers";
import type Stripe from "stripe";
import { logger } from "@/lib/core/logger";
import { commissionFor, CREATOR_CODE_COOKIE, CREATOR_CODE_METADATA, displayCode, normalizeCreatorCode, stripeCouponIdFor } from "@/lib/creator-codes/codes";
import { getServices } from "@/lib/services";
import type { CreatorCodeRow } from "@/types/database";
import { getStripe } from "./stripe";

/** The live creator code this visitor came in through, if any. */
export async function activeCreatorCode(): Promise<CreatorCodeRow | null> {
  const code = normalizeCreatorCode((await cookies()).get(CREATOR_CODE_COOKIE)?.value);
  if (!code) return null;
  try {
    const row = await getServices().repositories.creatorCodes.find(code);
    return row?.active ? row : null;
  } catch (error) {
    // A code that can't be looked up just means a checkout at the normal price.
    logger.warn("creator code lookup failed", { code, error });
    return null;
  }
}

/** Checkout session fields that apply a creator's discount and tag the subscription with the code. */
export function creatorCheckoutFields(code: CreatorCodeRow): { discounts: { coupon: string }[]; metadata: Record<string, string> } {
  return { discounts: [{ coupon: code.stripe_coupon_id }], metadata: { [CREATOR_CODE_METADATA]: code.code } };
}

export interface NewCreatorCode {
  code: string;
  creatorName: string;
  userId: string | null;
  discountPercent: number;
  discountMonths: number;
  commissionPercent: number;
  commissionMonths: number | null;
}

/**
 * Makes the Stripe coupon behind a code, then the code. Coupons can't be
 * changed once made, so a code's discount is fixed: to change it, switch the
 * code off and make a new one.
 */
export async function createCreatorCode(input: NewCreatorCode): Promise<CreatorCodeRow | "taken"> {
  const repo = getServices().repositories.creatorCodes;
  if (await repo.find(input.code)) return "taken";
  const couponId = stripeCouponIdFor(input.code);
  const stripe = getStripe();
  try {
    await stripe.coupons.retrieve(couponId);
  } catch {
    await stripe.coupons.create({
      id: couponId,
      name: `Creator code ${displayCode(input.code)}`,
      percent_off: input.discountPercent,
      duration: "repeating",
      duration_in_months: input.discountMonths,
    });
  }
  const row = await repo.create({
    code: input.code,
    creator_name: input.creatorName,
    user_id: input.userId,
    discount_percent: input.discountPercent,
    discount_months: input.discountMonths,
    commission_percent: input.commissionPercent,
    commission_months: input.commissionMonths,
    stripe_coupon_id: couponId,
  });
  return row ?? "taken";
}

const idOf = (value: string | { id: string } | null | undefined) => (typeof value === "string" ? value : (value?.id ?? null));

/**
 * A paid invoice from a subscription that started with a creator code: the
 * creator's share is recorded, once per invoice, for as long as the code pays.
 */
export async function recordCreatorCommission(invoice: Stripe.Invoice): Promise<void> {
  const code = normalizeCreatorCode(invoice.parent?.subscription_details?.metadata?.[CREATOR_CODE_METADATA]);
  if (!code) return;
  const repo = getServices().repositories.creatorCodes;
  const row = await repo.find(code);
  if (!row) return;
  const customerId = idOf(invoice.customer);
  const amountCents = invoice.total_excluding_tax ?? invoice.amount_paid;
  const paidAt = new Date((invoice.status_transitions?.paid_at ?? invoice.created) * 1000);
  const commission = commissionFor({
    amountCents,
    commissionPercent: row.commission_percent,
    commissionMonths: row.commission_months,
    paidAt,
    firstPaidAt: customerId ? await repo.firstPaidAt(row.id, customerId) : null,
  });
  if (commission === null) return;
  const recorded = await repo.recordCommission({
    code_id: row.id,
    stripe_invoice_id: invoice.id!,
    stripe_customer_id: customerId,
    user_id: invoice.parent?.subscription_details?.metadata?.userId ?? null,
    amount_cents: amountCents,
    commission_cents: commission,
    currency: invoice.currency,
    paid_at: paidAt.toISOString(),
  });
  if (recorded) logger.info("creator commission recorded", { code, invoiceId: invoice.id, commissionCents: commission });
}
