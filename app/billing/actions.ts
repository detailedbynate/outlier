"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireApprovedUser } from "@/lib/auth/session";
import { env } from "@/lib/core/env";
import { logger } from "@/lib/core/logger";
import { CREDIT_TAX_CODE, findPack } from "@/lib/billing/packs";
import { getStripe } from "@/lib/billing/stripe";

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
      metadata: { userId: current.user.id, packId: pack.id },
      success_url: `${base}/billing?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/billing?status=cancelled`,
    });
    url = session.url;
  } catch (error) {
    logger.error("stripe checkout failed", { userId: current.user.id, pack: pack.id, error });
  }
  redirect(url ?? "/billing?status=error");
}
