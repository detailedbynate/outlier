import type Stripe from "stripe";
import { env } from "@/lib/core/env";
import { logger } from "@/lib/core/logger";
import { fulfillCheckout, getStripe } from "@/lib/billing/stripe";
import { applySubscription } from "@/lib/billing/subscriptions";

export const dynamic = "force-dynamic";

/**
 * POST /api/stripe/webhook — Stripe tells us a Checkout finished. The signature
 * is checked against the raw body, so this can't use the JSON API handler.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = env().STRIPE_WEBHOOK_SECRET;
  if (!secret || !env().STRIPE_SECRET_KEY) return new Response("Payments aren't set up.", { status: 503 });

  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature.", { status: 400 });
  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, secret);
  } catch (error) {
    logger.warn("stripe webhook signature rejected", { error });
    return new Response("Bad signature.", { status: 400 });
  }

  try {
    // Card payments complete immediately; bank methods confirm later with async_payment_succeeded.
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      await fulfillCheckout(event.data.object);
    }
    // Every change to a subscription — bought, upgraded, cancelled, renewed, or
    // failing to pay — lands here, and the row is rewritten from what Stripe says.
    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await applySubscription(event.data.object);
    }
  } catch (error) {
    // A 500 makes Stripe retry, and applying the same event twice is harmless.
    logger.error("stripe event handling failed", { eventId: event.id, type: event.type, error });
    return new Response("Handling failed.", { status: 500 });
  }
  return Response.json({ received: true });
}
