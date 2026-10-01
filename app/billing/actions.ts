"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireApprovedUser } from "@/lib/auth/session";
import { env } from "@/lib/core/env";
import { logger } from "@/lib/core/logger";
import { CREDIT_TAX_CODE, findPack } from "@/lib/billing/packs";
import { FREE_TRIAL_DAYS, findPlan } from "@/lib/billing/plans";
import { priceIdFor } from "@/lib/billing/subscriptions";
import { getStripe } from "@/lib/billing/stripe";
import { freeTrialEligible, offerOpen, TRIAL_OFFER } from "@/lib/billing/trial";
import { getServices } from "@/lib/services";

async function siteUrl(): Promise<string> {
  const configured = env().SITE_URL;
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
}

/** Sends the user to Stripe's hosted checkout for a credit pack. Card details never touch Outlier. */
export async function startCheckout(formData: FormData): Promise<void> {
  const current = await requireApprovedUser();
  const pack = findPack(String(formData.get("packId") ?? ""));
  if (!pack) redirect("/billing?status=error");

  const base = await siteUrl();
  let url: string | null = null;
  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      // Stripe is the seller of record: it handles sales tax/VAT, fraud and disputes.
      managed_payments: { enabled: true },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: pack.priceCents,
            product_data: {
              name: `${pack.credits.toLocaleString("en-US")} Outlier credits`,
              description: "Credits never expire.",
              // Stripe manages tax (Managed Payments), which needs a digital-goods tax code: SaaS, business use.
              tax_code: CREDIT_TAX_CODE,
            },
          },
        },
      ],
      client_reference_id: current.user.id,
      customer_email: current.email || undefined,
      metadata: { userId: current.user.id, packId: pack.id },
      success_url: `${base}/billing?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/billing?status=cancelled`,
    });
    url = session.url;
  } catch (error) {
    logger.error("stripe checkout failed", { userId: current.user.id, pack: pack.id, error });
  }
  redirect(url ?? "/billing?status=error");
}

/**
 * Sends the user to Stripe's hosted checkout for a subscription. If they already
 * have a Stripe customer we reuse it, so a second plan doesn't create a second
 * customer and split their billing history in two.
 */
export async function startSubscription(formData: FormData): Promise<void> {
  const current = await requireApprovedUser();
  const plan = findPlan(String(formData.get("planId") ?? ""));
  const price = plan ? priceIdFor(plan) : null;
  if (!plan || !price) redirect("/billing?status=error");

  const base = await siteUrl();
  const existing = await getServices().subscriptions.stateFor(current.user.id);
  // A free trial for anyone who has never subscribed; Stripe charges when it ends.
  const freeTrial = freeTrialEligible(existing);
  // Someone on a trial, or just out of one, gets Expert at the trial price.
  const coupon = plan.id === TRIAL_OFFER.planId && offerOpen(existing.trial, Date.now()) ? await trialCoupon() : null;
  let url: string | null = null;
  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      // Stripe is the seller of record: it handles sales tax/VAT, fraud and disputes.
      managed_payments: { enabled: true },
      line_items: [{ price, quantity: 1 }],
      // Launch offers and comped accounts are run as Stripe promotion codes, so
      // the discount lives with the subscription instead of in our own pricing.
      // Stripe takes one or the other: the trial offer, or a code box.
      ...(coupon ? { discounts: [{ coupon }] } : { allow_promotion_codes: true }),
      client_reference_id: current.user.id,
      ...(existing.stripeCustomerId ? { customer: existing.stripeCustomerId } : { customer_email: current.email || undefined }),
      metadata: { userId: current.user.id, planId: plan.id },
      // Renewals and cancellations arrive with no metadata, so the subscription carries its own.
      subscription_data: {
        metadata: { userId: current.user.id, planId: plan.id },
        ...(freeTrial
          ? {
              trial_period_days: FREE_TRIAL_DAYS,
              // No card on file when the trial ends means no plan, not an unpaid one.
              trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
            }
          : {}),
      },
      payment_method_collection: "always",
      success_url: `${base}/billing?status=subscribed&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/billing?status=cancelled`,
    });
    url = session.url;
  } catch (error) {
    logger.error("stripe subscription checkout failed", { userId: current.user.id, plan: plan.id, error });
  }
  redirect(url ?? "/billing?status=error");
}

/**
 * The trial offer's coupon: money off Expert for its first few months, then
 * the normal price. Made in Stripe the first time anyone
 * takes the offer, so there's nothing to set up by hand. Null if Stripe won't
 * have it, and checkout goes ahead at the normal price.
 */
async function trialCoupon(): Promise<string | null> {
  const stripe = getStripe();
  try {
    return (await stripe.coupons.retrieve(TRIAL_OFFER.couponId)).id;
  } catch {
    try {
      return (
        await stripe.coupons.create({
          id: TRIAL_OFFER.couponId,
          name: "Trial offer",
          amount_off: TRIAL_OFFER.amountOffCents,
          currency: "usd",
          duration: "repeating",
          duration_in_months: TRIAL_OFFER.months,
        })
      ).id;
    } catch (error) {
      logger.error("trial coupon unavailable", { error });
      return null;
    }
  }
}

/**
 * Sends the user to Stripe's billing portal, where they change plan, update a
 * card or cancel. Outlier never handles any of that itself.
 */
export async function openBillingPortal(): Promise<void> {
  const current = await requireApprovedUser();
  const state = await getServices().subscriptions.stateFor(current.user.id);
  if (!state.stripeCustomerId) redirect("/billing?status=error");

  const base = await siteUrl();
  let url: string | null = null;
  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: state.stripeCustomerId,
      return_url: `${base}/billing`,
    });
    url = session.url;
  } catch (error) {
    logger.error("stripe billing portal failed", { userId: current.user.id, error });
  }
  redirect(url ?? "/billing?status=error");
}
