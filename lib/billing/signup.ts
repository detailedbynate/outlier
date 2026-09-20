import "server-only";
import type Stripe from "stripe";
import { AppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { getAdminDatabase } from "@/lib/database";
import { getServices } from "@/lib/services";
import { env } from "@/lib/core/env";
import { INVITE_TTL_MS } from "@/lib/auth/signup-invites";
import { emailEnabled, sendEmail, signupEmail } from "@/lib/email/send";
import { planOrFree } from "./plans";
import { applySubscription, planForSubscription } from "./subscriptions";
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
  const site = env().SITE_URL ?? "https://www.useoutlier.online";
  const existingId = await services.repositories.accounts.userIdByEmail(email);
  // Only ask about an account once there's an id to ask about: "" is not a uuid.
  const account = existingId ? await services.repositories.accounts.findByUserId(existingId) : null;
  const { userId } = account ? { userId: existingId! } : await services.accounts.provisionSubscriber(email, `${site}/`);
  if (!userId) throw new AppError("UPSTREAM_ERROR", "Subscriber account could not be created.");

  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  // Renewals and cancellations carry no session, so the subscription itself has
  // to remember whose it is.
  if (!subscription.metadata?.userId) {
    await getStripe().subscriptions.update(subscriptionId, { metadata: { ...subscription.metadata, userId } });
  }
  await applySubscription(subscription, userId);

  // Whether the auth user is new says nothing about whether they can sign in: a
  // half-finished signup leaves one with no password. Ask the only question that
  // matters — has this person ever got in? — so nobody is left locked out of
  // something they paid for.
  const needsPassword = await hasNeverSignedIn(userId);
  if (needsPassword) await sendSignupInvite(userId, email, planOrFree(planForSubscription(subscription)).name);
  logger.info("subscriber account ready", { userId, sessionId: session.id, invited: needsPassword });
  return { email };
}

/** Has this account never been signed into? Then it has no password worth keeping. */
async function hasNeverSignedIn(userId: string): Promise<boolean> {
  try {
    const { data, error } = await getAdminDatabase().auth.admin.getUserById(userId);
    if (error || !data.user) return true;
    return !data.user.last_sign_in_at;
  } catch (error) {
    // Unsure: send the link. A spare email beats a locked-out subscriber.
    logger.warn("could not check sign-in history", { userId, error });
    return true;
  }
}

/**
 * Email the one-time link that lets a new subscriber set a password. A failure
 * here must not fail the payment: the account exists either way, and they can
 * ask for a new link from the sign-in page.
 */
export async function sendSignupInvite(userId: string, email: string, planName: string): Promise<boolean> {
  if (!emailEnabled()) {
    logger.error("no email provider configured, subscriber has no way in", { userId });
    return false;
  }
  try {
    const { token } = await getServices().repositories.signupInvites.create(userId, email);
    const { subject, html, text } = signupEmail({
      planName,
      url: `${env().SITE_URL ?? "https://www.useoutlier.online"}/signup?token=${encodeURIComponent(token)}`,
      days: Math.round(INVITE_TTL_MS / 86_400_000),
    });
    await sendEmail({ to: email, subject, html, text });
    return true;
  } catch (error) {
    logger.error("signup invite email failed", { userId, error });
    return false;
  }
}
