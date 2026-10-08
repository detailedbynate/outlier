"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { FREE_TRIAL_DAYS, findPlan } from "@/lib/billing/plans";
import { getStripe } from "@/lib/billing/stripe";
import { activeCreatorCode, creatorCheckoutFields } from "@/lib/billing/creator-codes";
import { checkoutVisitorMetadata, recordSiteEvent } from "@/lib/analytics/site-events";
import { fullPriceIdFor, priceIdFor } from "@/lib/billing/subscriptions";
import { env } from "@/lib/core/env";
import { logger } from "@/lib/core/logger";
import { getServices } from "@/lib/services";
import { clientIpFrom } from "@/lib/services/rate-limit-service";
import { getCurrentUser } from "@/lib/auth/session";

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
  // Already have an account: subscribe it from Billing, where the creator code applies too.
  if (await getCurrentUser()) redirect("/billing#plans");

  const h = await headers();
  const base = await siteUrl(h);
  let url: string | null = null;
  try {
    await getServices().rateLimits.enforce("checkoutIp", clientIpFrom(h));
    // Came in on a creator's link (or typed their code): their discount applies wherever they check out from,
    // so the creator gets credit. Not on the free trial, though: whoever clicks that gets the trial they picked.
    const code = freeTrial ? null : await activeCreatorCode();
    const creator = code ? await creatorCheckoutFields(code) : null;
    // A creator's discount comes off the full price, not the launch price.
    const billed = creator ? ((await fullPriceIdFor(plan)) ?? price) : price;
    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      // Stripe is the seller of record: it handles sales tax/VAT, fraud and disputes.
      managed_payments: { enabled: true },
      line_items: [{ price: billed, quantity: 1 }],
      // Stripe takes a set discount or a code box, not both.
      ...(creator ? { discounts: creator.discounts } : { allow_promotion_codes: true }),
      metadata: { planId: plan.id, ...creator?.metadata, ...(await checkoutVisitorMetadata()) },
      subscription_data: {
        metadata: { planId: plan.id, ...creator?.metadata },
        // The free-trial offer (the popup) asks for it; the plan buttons charge straight away.
        // A creator's discount is the offer for code visitors; it doesn't stack with the free trial.
        ...(freeTrial && !creator
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
    await recordSiteEvent("checkout_start", { path: "/", detail: freeTrial ? `${plan.id} (free trial)` : plan.id, creator_code: creator ? code!.code : null });
  } catch (error) {
    logger.error("public subscription checkout failed", { plan: plan.id, error });
  }
  redirect(url ?? "/?checkout=error#pricing");
}
