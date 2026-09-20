"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { findPlan } from "@/lib/billing/plans";
import { getStripe } from "@/lib/billing/stripe";
import { priceIdFor } from "@/lib/billing/subscriptions";
import { env } from "@/lib/core/env";
import { logger } from "@/lib/core/logger";
import { getServices } from "@/lib/services";
import { clientIpFrom } from "@/lib/services/rate-limit-service";

async function siteUrl(h: Headers): Promise<string> {
  const configured = env().SITE_URL;
  if (configured) return configured;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
}

/**
 * Subscribe without an account. Stripe collects the email, and paying is what
 * creates the account — see fulfillPublicSubscription. Rate limited per IP,
 * since this is reachable by anyone.
 */
export async function startPublicSubscription(formData: FormData): Promise<void> {
  const plan = findPlan(String(formData.get("planId") ?? ""));
  const price = plan ? priceIdFor(plan) : null;
  if (!plan || !price) redirect("/?checkout=error#pricing");

  const h = await headers();
  const base = await siteUrl(h);
  let url: string | null = null;
  try {
    await getServices().rateLimits.enforce("checkoutIp", clientIpFrom(h));
    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      // Stripe is the seller of record: it handles sales tax/VAT, fraud and disputes.
      managed_payments: { enabled: true },
      line_items: [{ price, quantity: 1 }],
      allow_promotion_codes: true,
      metadata: { planId: plan.id },
      subscription_data: { metadata: { planId: plan.id } },
      success_url: `${base}/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/?checkout=cancelled#pricing`,
    });
    url = session.url;
  } catch (error) {
    logger.error("public subscription checkout failed", { plan: plan.id, error });
  }
  redirect(url ?? "/?checkout=error#pricing");
}
