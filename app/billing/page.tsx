import type { Metadata } from "next";
import { CoinsIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { requireApprovedUser } from "@/lib/auth/session";
import { logger } from "@/lib/core/logger";
import { CREDIT_PACKS, formatPrice } from "@/lib/billing/packs";
import { billingEnabled, fulfillCheckout, getStripe } from "@/lib/billing/stripe";
import { getServices } from "@/lib/services";
import { startCheckout } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Credits · Outlier" };

type SearchParams = Promise<{ status?: string; session_id?: string }>;

export default async function BillingPage({ searchParams }: { searchParams: SearchParams }) {
  const current = await requireApprovedUser();
  const { status, session_id: sessionId } = await searchParams;

  // Back from Stripe: credit the purchase now rather than waiting on the webhook.
  let bought: number | null = null;
  if (status === "success" && sessionId?.startsWith("cs_") && billingEnabled()) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(sessionId);
      if (session.client_reference_id === current.user.id) bought = (await fulfillCheckout(session))?.credits ?? null;
    } catch (error) {
      logger.warn("checkout return lookup failed", { sessionId, error });
    }
  }

  const credits = await getServices().credits.status(current.user.id);
  const enabled = billingEnabled();

  return (
    <div className="research-page">
      <PageHeader icon={CoinsIcon} title="Credits" subtitle="Your monthly credits reset on the 1st. Bought credits never expire and are used once the monthly ones run out." />

      {status === "success" ? (
        <div className="billing-notice" data-tone="good" role="status">
          {bought ? `Payment received: ${bought.toLocaleString("en-US")} credits added.` : "Payment received. Your credits will appear in a moment — refresh if they don't."}
        </div>
      ) : status === "cancelled" ? (
        <div className="billing-notice" role="status">
          Checkout cancelled. You weren&apos;t charged.
        </div>
      ) : status === "error" ? (
        <div className="billing-notice" data-tone="bad" role="status">
          Couldn&apos;t start checkout. Try again in a minute.
        </div>
      ) : null}

      <section className="card glass billing-balance">
        <div>
          <span className="stat-note">Credits left</span>
          <strong>{credits.limit >= 1_000_000 ? "Unlimited" : credits.remaining.toLocaleString("en-US")}</strong>
        </div>
        <div>
          <span className="stat-note">Monthly</span>
          <strong>{Math.max(credits.monthly - credits.used, 0).toLocaleString("en-US")}</strong>
        </div>
        <div>
          <span className="stat-note">Bought / extra</span>
          <strong>{credits.extra.toLocaleString("en-US")}</strong>
        </div>
      </section>

      {enabled ? (
        <section className="billing-packs" aria-label="Credit packs">
          {CREDIT_PACKS.map((pack) => (
            <form key={pack.id} action={startCheckout} className="card glass billing-pack">
              <input type="hidden" name="packId" value={pack.id} />
              <span className="billing-pack-label">{pack.label}</span>
              <strong className="billing-pack-credits">{pack.credits.toLocaleString("en-US")} credits</strong>
              <span className="billing-pack-price">{formatPrice(pack.priceCents)}</span>
              <span className="stat-note">{formatPrice(Math.round((pack.priceCents / pack.credits) * 100))} per 100 credits</span>
              <button type="submit" className={pack.id === "medium" ? "button-brand" : undefined}>
                Buy
              </button>
            </form>
          ))}
        </section>
      ) : (
        <div className="empty">Buying credits isn&apos;t available yet.</div>
      )}
      <p className="stat-note">Payments are handled by Stripe. Outlier never sees your card details.</p>
    </div>
  );
}
