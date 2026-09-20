import type { Metadata } from "next";
import { CoinsIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { requireApprovedUser } from "@/lib/auth/session";
import { logger } from "@/lib/core/logger";
import { CREDIT_PACKS, formatPrice } from "@/lib/billing/packs";
import { billingEnabled, fulfillCheckout, getStripe } from "@/lib/billing/stripe";
import { getServices } from "@/lib/services";
import { onSale, PLANS } from "@/lib/billing/plans";
import { sellablePlans, syncSubscription } from "@/lib/billing/subscriptions";
import { openBillingPortal, startCheckout, startSubscription } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Credits · Outlier" };

type SearchParams = Promise<{ status?: string; session_id?: string }>;

const PLAN_ORDER = new Map(PLANS.map((plan, index) => [plan.id, index]));

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

  // Back from a subscription checkout: read the plan from Stripe rather than
  // waiting on the webhook, so the new allowance is visible immediately.
  if (status === "subscribed" && sessionId?.startsWith("cs_") && billingEnabled()) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(sessionId);
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (session.client_reference_id === current.user.id && subscriptionId) await syncSubscription(subscriptionId);
    } catch (error) {
      logger.warn("subscription return lookup failed", { sessionId, error });
    }
  }

  const services = getServices();
  const credits = await services.credits.status(current.user.id);
  const subscription = await services.subscriptions.stateFor(current.user.id);
  const enabled = billingEnabled();
  const plans = sellablePlans();
  const now = new Date();

  return (
    <div className="research-page">
      <PageHeader icon={CoinsIcon} title="Credits" subtitle="Your monthly credits reset on the 1st. Bought credits never expire and are used once the monthly ones run out." />

      {status === "subscribed" ? (
        <div className="billing-notice" data-tone="good" role="status">
          You&apos;re on {subscription.plan.name}. Your new monthly credits are available now.
        </div>
      ) : status === "success" ? (
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

      {enabled && plans.length > 0 ? (
        <section aria-label="Plans">
          <h2 className="section-title">Plans</h2>
          <p className="stat-note">
            {subscription.plan.priceCents > 0
              ? subscription.cancelAtPeriodEnd
                ? `Your ${subscription.plan.name} plan ends ${subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString("en-US", { dateStyle: "medium" }) : "at the end of this period"}.`
                : `You're on ${subscription.plan.name}. Change or cancel any time.`
              : "Pick a plan for more credits each month, or stay on Free."}
          </p>
          <div className="billing-plans">
            {plans.map((plan) => {
              const isCurrent = subscription.plan.id === plan.id;
              const sale = onSale(plan, now);
              return (
                <form key={plan.id} action={isCurrent ? openBillingPortal : startSubscription} className="card glass billing-plan" data-current={isCurrent}>
                  <input type="hidden" name="planId" value={plan.id} />
                  <div className="billing-plan-head">
                    <strong>{plan.name}</strong>
                    {isCurrent ? <span className="pill">Your plan</span> : plan.badge ? <span className="pill">{plan.badge}</span> : null}
                  </div>
                  <div className="billing-plan-price">
                    <strong>{formatPrice(plan.priceCents)}</strong>
                    <span className="stat-note">/month</span>
                    {sale ? <span className="billing-plan-was">{formatPrice(plan.listPriceCents!)}</span> : null}
                  </div>
                  {sale ? <span className="stat-note">Launch price until 1 October, then {formatPrice(plan.listPriceCents!)}.</span> : null}
                  <p className="billing-plan-blurb">{plan.blurb}</p>
                  <ul className="billing-plan-features">
                    <li>
                      <strong>{plan.monthlyCredits.toLocaleString("en-US")}</strong> credits a month
                    </li>
                    {plan.features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                  <button type="submit" className={plan.badge && !isCurrent ? "button-brand" : undefined}>
                    {isCurrent ? "Manage plan" : PLAN_ORDER.get(plan.id)! < PLAN_ORDER.get(subscription.plan.id)! ? "Switch" : "Upgrade"}
                  </button>
                </form>
              );
            })}
          </div>
          {subscription.hasBilling && subscription.plan.priceCents === 0 ? (
            <form action={openBillingPortal}>
              <button type="submit">
                Billing history and invoices
              </button>
            </form>
          ) : null}
        </section>
      ) : null}

      {enabled ? (
        <section className="billing-packs" aria-label="Credit packs">
          <h2 className="section-title">Top up</h2>
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
