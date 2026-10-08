"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { FREE_TRIAL_DAYS, findPlan } from "@/lib/billing/plans";
import { getStripe } from "@/lib/billing/stripe";
import { activeCreatorCode, creatorCheckoutFields } from "@/lib/billing/creator-codes";
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
  const freeTrial = formData.get("trial") === "1";

  const h = await headers();
  const base = await siteUrl(h);
  let url: string | null = null;
  try {
    await getServices().rateLimits.enforce("checkoutIp", clientIpFrom(h));
    const code = await activeCreatorCode();
    const creator = code ? creatorCheckoutFields(code) : null;
    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      // Stripe is the seller of record: it handles sales tax/VAT, fraud and disputes.
      managed_payments: { enabled: true },
      line_items: [{ price, quantity: 1 }],
      // Stripe takes a set discount or a code box, not both.
      ...(creator ? { discounts: creator.discounts } : { allow_promotion_codes: true }),
      metadata: { planId: plan.id, ...creator?.metadata },
      subscription_data: {
        metadata: { planId: plan.id, ...creator?.metadata },
        // The free-trial offer (the popup) asks for it; the plan buttons charge straight away.
        ...(freeTrial
          ? {
              trial_period_days: FREE_TRIAL_DAYS,
              // No card on file when the trial ends means no plan, not an unpaid one.
              trial_settings: { end_behavior: { missing_payment_method: "cancel" as const } },
            }
          : {}),
      },
      payment_method_collection: "always",
      success_url: `${base}/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/?checkout=cancelled#pricing`,
    });
    url = session.url;
  } catch (error) {
    logger.error("public subscription checkout failed", { plan: plan.id, error });
  }
  redirect(url ?? "/?checkout=error#pricing");
}
