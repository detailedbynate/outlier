import "server-only";
import Stripe from "stripe";
import { env } from "@/lib/core/env";
import { AppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { getServices } from "@/lib/services";
import { findPack } from "./packs";

let client: Stripe | undefined;

export function billingEnabled(): boolean {
  return Boolean(env().STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  const key = env().STRIPE_SECRET_KEY;
  if (!key) throw new AppError("CONFIG_ERROR", "Payments aren't set up yet.", { expose: true });
  client ??= new Stripe(key);
  return client;
}

/**
 * Credit a paid Checkout session to its user. Called from both the webhook and
 * the return page, so whichever arrives first wins and the other is a no-op.
 */
export async function fulfillCheckout(session: Stripe.Checkout.Session): Promise<{ added: boolean; credits: number } | null> {
  if (session.payment_status !== "paid") return null;
  const userId = session.client_reference_id ?? session.metadata?.userId;
  const pack = findPack(session.metadata?.packId);
  if (!userId || !pack) {
    logger.error("stripe session missing user or pack", { sessionId: session.id });
    return null;
  }
  const added = await getServices().credits.addPurchase(userId, pack.credits, session.id, `${pack.credits} credits (${pack.id})`);
  if (added) logger.info("credits purchased", { userId, pack: pack.id, sessionId: session.id });
  return { added, credits: pack.credits };
}
