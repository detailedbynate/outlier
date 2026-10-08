"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireApprovedUser } from "@/lib/auth/session";
import { env } from "@/lib/core/env";
import { logger } from "@/lib/core/logger";
import { CREDIT_TAX_CODE, findPack } from "@/lib/billing/packs";
import { findPlan } from "@/lib/billing/plans";
import { fullPriceIdFor, priceIdFor } from "@/lib/billing/subscriptions";
import { getStripe } from "@/lib/billing/stripe";
import { offerOpen, TRIAL_OFFER } from "@/lib/billing/trial";
import { activeCreatorCode, creatorCheckoutFields } from "@/lib/billing/creator-codes";
import { checkoutVisitorMetadata, recordSiteEvent } from "@/lib/analytics/site-events";
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
      metadata: { userId: current.user.id, packId: pack.id, ...(await checkoutVisitorMetadata()) },
      success_url: `${base}/billing?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/billing?status=cancelled`,
    });
    url = session.url;
    await recordSiteEvent("checkout_start", { signed_in: true, path: "/billing", detail: pack.id, amount_cents: pack.priceCents });
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
  // A creator's code beats the trial offer: it's what the creator gets paid on. Not their own code, though.
  const code = await activeCreatorCode();
  const creator = code && code.user_id !== current.user.id ? await creatorCheckoutFields(code) : null;
  // A creator's discount comes off the full price, not the launch price.
  const billed = creator ? ((await fullPriceIdFor(plan!)) ?? price!) : price!;
  // Someone on a trial, or just out of one, gets Expert at the trial price.
  const coupon = !creator && plan.id === TRIAL_OFFER.planId && offerOpen(existing.trial, Date.now()) ? await trialCoupon() : null;
  let url: string | null = null;
  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      // Stripe is the seller of record: it handles sales tax/VAT, fraud and disputes.
      managed_payments: { enabled: true },
      line_items: [{ price: billed, quantity: 1 }],
      // Launch offers and comped accounts are run as Stripe promotion codes, so
      // the discount lives with the subscription instead of in our own pricing.
      // Stripe takes one or the other: the trial offer, or a code box.
      ...(creator ? { discounts: creator.discounts } : coupon ? { discounts: [{ coupon }] } : { allow_promotion_codes: true }),
      client_reference_id: current.user.id,
      ...(existing.stripeCustomerId ? { customer: existing.stripeCustomerId } : { customer_email: current.email || undefined }),
      metadata: { userId: current.user.id, planId: plan.id, ...creator?.metadata, ...(await checkoutVisitorMetadata()) },
      // Renewals and cancellations arrive with no metadata, so the subscription carries its own.
      // The creator code rides along too: every invoice it pays commission on carries it.
      subscription_data: { metadata: { userId: current.user.id, planId: plan.id, ...creator?.metadata } },
      success_url: `${base}/billing?status=subscribed&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/billing?status=cancelled`,
    });
    url = session.url;
    await recordSiteEvent("checkout_start", { signed_in: true, path: "/billing", detail: plan.id, creator_code: creator ? code!.code : null });
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

/** Forget their Discord account and take the paid roles back. */
export async function disconnectDiscord(): Promise<void> {
  const current = await requireApprovedUser();
  try {
    await getServices().discord.unlink(current.user.id);
  } catch (error) {
    logger.warn("discord unlink failed", { userId: current.user.id, error: error instanceof Error ? error.message : String(error) });
  }
  redirect("/billing?discord=disconnected#discord");
}
