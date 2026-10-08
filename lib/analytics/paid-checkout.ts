import "server-only";
import type Stripe from "stripe";
import { CREATOR_CODE_METADATA } from "@/lib/creator-codes/codes";
import { recordSiteEvent } from "./site-events";

/**
 * Count a finished checkout on the traffic page. Stripe sends a session's
 * completion more than once at times; the session id keeps it to one row.
 * Card payments arrive paid; bank payments are counted when they clear.
 */
export async function recordPaidCheckout(session: Stripe.Checkout.Session): Promise<void> {
  if (session.payment_status === "unpaid") return;
  const metadata = session.metadata ?? {};
  await recordSiteEvent(
    session.mode === "subscription" ? "subscribed" : "purchase",
    {
      signed_in: Boolean(metadata.userId),
      detail: metadata.planId ?? metadata.packId ?? null,
      amount_cents: session.amount_total ?? null,
      creator_code: metadata[CREATOR_CODE_METADATA] ?? null,
      dedupe_key: `checkout:${session.id}`,
      visitor: metadata.siteVisitor ?? null,
    },
    { fromRequest: false },
  );
}
