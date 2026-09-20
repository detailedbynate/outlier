import "server-only";
import type Stripe from "stripe";
import { env } from "@/lib/core/env";
import { logger } from "@/lib/core/logger";
import { getServices } from "@/lib/services";
import { findPlan, PAID_PLANS, type Plan, type PlanId } from "./plans";
import { getStripe } from "./stripe";

/**
 * The Stripe side of subscriptions: which plans can actually be sold, and how a
 * Stripe subscription becomes a row in our database.
 *
 * Stripe stays the source of truth. Every path that changes a plan — checkout
 * returning, a webhook arriving, someone cancelling in the portal — ends in
 * `applySubscription`, so they can arrive in any order and the last word is
 * whatever Stripe currently says.
 */

/** The recurring Price a plan is billed against, or null when it isn't configured. */
export function priceIdFor(plan: Plan): string | null {
  const config = env();
  if (plan.id === "pro") return config.STRIPE_PRICE_PRO ?? null;
  if (plan.id === "expert") return config.STRIPE_PRICE_EXPERT ?? null;
  return null;
}

/** Paid plans that have a Stripe Price behind them, so we can't sell what we can't bill. */
export function sellablePlans(): Plan[] {
  return PAID_PLANS.filter((plan) => priceIdFor(plan) !== null);
}

/** The plan a Stripe subscription is for, read back from the Price it bills. */
export function planForSubscription(subscription: Stripe.Subscription): PlanId | null {
  const priceId = subscription.items.data[0]?.price.id;
  if (!priceId) return null;
  for (const plan of PAID_PLANS) {
    if (priceIdFor(plan) === priceId) return plan.id;
  }
  // A Price we no longer sell: honour it by name if the metadata says which plan.
  return findPlan(subscription.metadata?.planId)?.id ?? null;
}

function periodEnd(subscription: Stripe.Subscription): string | null {
  // The period lives on the item in current Stripe API versions.
  const seconds = subscription.items.data[0]?.current_period_end;
  return typeof seconds === "number" ? new Date(seconds * 1_000).toISOString() : null;
}

function customerId(subscription: Stripe.Subscription): string | null {
  const customer = subscription.customer;
  return typeof customer === "string" ? customer : (customer?.id ?? null);
}

/**
 * Write a Stripe subscription into our database. The user is named by the
 * subscription's metadata, falling back to whoever we already have on file for
 * that Stripe customer — which is how cancellations and renewals find their way
 * home, since those events carry no metadata of ours.
 */
export async function applySubscription(subscription: Stripe.Subscription): Promise<void> {
  const services = getServices();
  const customer = customerId(subscription);
  const userId = subscription.metadata?.userId || (customer ? await services.subscriptions.userIdForCustomer(customer) : null);
  if (!userId) {
    logger.error("stripe subscription has no user", { subscriptionId: subscription.id, customer });
    return;
  }
  const plan = planForSubscription(subscription);
  if (!plan) {
    logger.error("stripe subscription has no known plan", { subscriptionId: subscription.id, userId });
    return;
  }
  // "canceled" and "incomplete_expired" are the end of the line: back to free.
  const ended = subscription.status === "canceled" || subscription.status === "incomplete_expired";
  await services.subscriptions.apply({
    userId,
    plan: ended ? "free" : plan,
    status: subscription.status,
    stripeCustomerId: customer,
    stripeSubscriptionId: subscription.id,
    currentPeriodEnd: periodEnd(subscription),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  });
}

/** Pull a subscription fresh from Stripe and apply it. Used when checkout returns. */
export async function syncSubscription(subscriptionId: string): Promise<void> {
  await applySubscription(await getStripe().subscriptions.retrieve(subscriptionId));
}
