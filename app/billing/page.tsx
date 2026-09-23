import type { Metadata } from "next";
import { CoinsIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { requireApprovedUser } from "@/lib/auth/session";
import { logger } from "@/lib/core/logger";
import { CREDIT_PACKS, formatPrice } from "@/lib/billing/packs";
import { billingEnabled, fulfillCheckout, getStripe } from "@/lib/billing/stripe";
import { getServices } from "@/lib/services";
import { FREE_PLAN, onSale, PLANS } from "@/lib/billing/plans";
import { ZapIcon } from "@/components/icons";
import { sellablePlans, syncSubscription } from "@/lib/billing/subscriptions";
import { openBillingPortal, startCheckout, startSubscription } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Credits · Outlier" };

type SearchParams = Promise<{ status?: string; session_id?: string }>;

const PLAN_ORDER = new Map(PLANS.map((plan, index) => [plan.id, index]));
/** The cheapest top-up, quoted on every plan so the credit cap never looks like a wall. */
const cheapestPack = [...CREDIT_PACKS].sort((a, b) => a.priceCents - b.priceCents)[0]!;

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
    <div className="research-page billing-page">
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
        <section className="billing-plans-section" aria-label="Plans">
          <h2 className="section-title">Plans</h2>
          <p className="billing-plans-lede">
            {subscription.plan.priceCents > 0
              ? subscription.cancelAtPeriodEnd
                ? `Your ${subscription.plan.name} plan ends ${subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString("en-US", { dateStyle: "medium" }) : "at the end of this period"}.`
                : `You're on ${subscription.plan.name}. Change or cancel any time.`
              : "More credits each month, so research doesn't stop halfway through the week."}
          </p>
          <div className="billing-plans">
            {[FREE_PLAN, ...plans].map((plan) => {
              const isCurrent = subscription.plan.id === plan.id;
              const sale = onSale(plan, now);
              const paid = plan.priceCents > 0;
              return (
                <form
                  key={plan.id}
                  action={isCurrent && paid ? openBillingPortal : startSubscription}
                  className="billing-plan"
                  data-plan={plan.id}
                  data-current={isCurrent}
                  data-featured={Boolean(plan.badge)}
                >
                  <input type="hidden" name="planId" value={plan.id} />

                  <div className="billing-plan-head">
                    <h3>{plan.name}</h3>
                    {isCurrent ? (
                      <span className="billing-plan-badge" data-tone="current">
                        Your plan
                      </span>
                    ) : plan.badge ? (
                      <span className="billing-plan-badge">{plan.badge}</span>
                    ) : null}
                  </div>
                  <p className="billing-plan-blurb">{plan.blurb}</p>

                  <div className="billing-plan-credits">
                    <strong>
                      <ZapIcon size={16} />
                      {plan.monthlyCredits.toLocaleString("en-US")} credits/mo.
                    </strong>
                    <span>{plan.creditsNote}</span>
                    <span className="billing-plan-topup">Top up any time from {formatPrice(cheapestPack.priceCents)} — bought credits never expire</span>
                  </div>

                  <div className="billing-plan-price">
                    <strong>{paid ? formatPrice(plan.priceCents) : "Free"}</strong>
                    {sale ? <span className="billing-plan-was">{formatPrice(plan.listPriceCents!)}</span> : null}
                  </div>
                  <span className="billing-plan-terms">
                    {paid ? "per month, billed monthly" : "no card needed"}
                    {sale ? ` · launch price until 1 October, then ${formatPrice(plan.listPriceCents!)}` : ""}
                  </span>

                  {paid || isCurrent ? (
                    <button type="submit" className="billing-plan-cta" disabled={isCurrent && !paid}>
                      {isCurrent ? (paid ? "Manage plan" : "Your plan") : PLAN_ORDER.get(plan.id)! < PLAN_ORDER.get(subscription.plan.id)! ? `Switch to ${plan.name}` : `Get ${plan.name}`}
                    </button>
                  ) : (
                    <span className="billing-plan-cta is-placeholder">Included with every account</span>
                  )}
                  {paid ? <span className="billing-plan-terms is-centred">Cancel any time</span> : null}

                  <ul className="billing-plan-features">
                    {plan.features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                </form>
              );
            })}
          </div>
          {subscription.hasBilling && subscription.plan.priceCents === 0 ? (
            <form action={openBillingPortal}>
              <button type="submit">Billing history and invoices</button>
            </form>
          ) : null}
        </section>
      ) : null}

      {enabled ? (
        <section className="billing-packs-section" aria-label="Credit packs">
          <h2 className="section-title">Top up</h2>
          <p className="billing-plans-lede">One-off credits on top of your plan. They never expire.</p>
          <div className="billing-packs">
            {CREDIT_PACKS.map((pack) => (
              <form key={pack.id} action={startCheckout} className="billing-pack" data-pack={pack.id}>
                <input type="hidden" name="packId" value={pack.id} />
                <span className="billing-pack-label">{pack.label}</span>
                <strong className="billing-pack-credits">{pack.credits.toLocaleString("en-US")} credits</strong>
                <span className="billing-pack-price">{formatPrice(pack.priceCents)}</span>
                <span className="stat-note">{formatPrice(Math.round((pack.priceCents / pack.credits) * 100))} per 100 credits</span>
                <button type="submit" className="billing-pack-cta">
                  Buy
                </button>
              </form>
            ))}
          </div>
        </section>
      ) : (
        <div className="empty">Buying credits isn&apos;t available yet.</div>
      )}
      <p className="stat-note">Payments are handled by Stripe. Outlier never sees your card details.</p>
    </div>
  );
}
