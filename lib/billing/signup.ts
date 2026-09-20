import "server-only";
import type Stripe from "stripe";
import { AppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { getServices } from "@/lib/services";
import { applySubscription } from "./subscriptions";
import { getStripe } from "./stripe";

/**
 * Paying is how you get an account.
 *
 * Someone subscribing from the public pricing page has no account yet, so the
 * payment creates one: provision the auth user, give them an account row (which
 * is what marks them approved), then write the subscription against that user.
 *
 * It runs from the webhook and from the return page, whichever arrives first,
 * and doing it twice is a no-op: provisioning an existing email returns the same
 * user, and the subscription row is keyed by user.
 */
export async function fulfillPublicSubscription(session: Stripe.Checkout.Session): Promise<{ email: string } | null> {
  if (session.mode !== "subscription" || session.payment_status === "unpaid") return null;
  // A signed-in user's checkout carries their id; this is only for the ones that don't.
  if (session.client_reference_id || session.metadata?.userId) return null;

  const email = session.customer_details?.email ?? session.customer_email;
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (!email || !subscriptionId) {
    logger.error("paid subscription with no email or subscription", { sessionId: session.id });
    return null;
  }

  const services = getServices();
  const existingId = await services.repositories.accounts.userIdByEmail(email);
  const account = await services.repositories.accounts.findByUserId(existingId ?? "");
  let userId = existingId;

  if (!account) {
    // Emails them a sign-in link, which is how they get in the first time.
    const provisioned = await services.accounts.provisionSubscriber(email);
    userId = provisioned.userId;
  }
  if (!userId) throw new AppError("UPSTREAM_ERROR", "Subscriber account could not be created.");

  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  // Renewals and cancellations carry no session, so the subscription itself has
  // to remember whose it is.
  if (!subscription.metadata?.userId) {
    await getStripe().subscriptions.update(subscriptionId, { metadata: { ...subscription.metadata, userId } });
  }
  await applySubscription(subscription, userId);
  logger.info("subscriber account ready", { userId, sessionId: session.id });
  return { email };
}
