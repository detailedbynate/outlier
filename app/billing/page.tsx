import type { Metadata } from "next";
import { CoinsIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { requireApprovedUser } from "@/lib/auth/session";
import { logger } from "@/lib/core/logger";
import { CREDIT_PACKS, formatPrice } from "@/lib/billing/packs";
import { billingEnabled, fulfillCheckout, getStripe } from "@/lib/billing/stripe";
import { getServices } from "@/lib/services";
import { FREE_PLAN, fullPriceCents, onSale, PLANS, SALE_ENDS_LABEL } from "@/lib/billing/plans";
import { activeCreatorCode } from "@/lib/billing/creator-codes";
import { discountLabel, displayCode } from "@/lib/creator-codes/codes";
import { CreatorCodeEntry } from "@/components/creator-code-entry";
import { ZapIcon } from "@/components/icons";
import { priceCentsFor, sellablePlans, syncSubscription } from "@/lib/billing/subscriptions";
import { offerOpen, timeLeft, TRIAL_OFFER } from "@/lib/billing/trial";
import { disconnectDiscord, openBillingPortal, startCheckout, startSubscription } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Credits · Outlier" };

type SearchParams = Promise<{ status?: string; session_id?: string; code_error?: string; discord?: string }>;

const PLAN_ORDER = new Map(PLANS.map((plan, index) => [plan.id, index]));
/** The cheapest top-up, quoted on every plan so the credit cap never looks like a wall. */
const cheapestPack = [...CREDIT_PACKS].sort((a, b) => a.priceCents - b.priceCents)[0]!;

export default async function BillingPage({ searchParams }: { searchParams: SearchParams }) {
  const current = await requireApprovedUser();
  const { status, session_id: sessionId, code_error: codeError, discord: discordResult } = await searchParams;

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
  const trial = subscription.trial;
  const trialLive = trial !== null && Date.parse(trial.endsAt) > now.getTime();
  const trialOffer = offerOpen(trial, now.getTime());
  // Stripe's own trial: they've subscribed, and the first charge is at the period end.
  const stripeTrial = subscription.status === "trialing" && subscription.plan.priceCents > 0;
  // A creator's code (from their link or typed below) beats the trial offer, as at checkout. Not their own code, though.
  const code = await activeCreatorCode();
  const creator = code && code.user_id !== current.user.id ? code : null;
  const discordLink = services.discord.enabled ? await services.discord.link(current.user.id) : null;
  const fmtEnd = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

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
        <section id="plans" className="billing-plans-section" aria-label="Plans">
          <h2 className="section-title">Plans</h2>
          <p className="billing-plans-lede">
            {trial && trialLive
              ? `You're on a free ${subscription.plan.name} trial until ${fmtEnd(trial.endsAt)} (${timeLeft(Date.parse(trial.endsAt) - now.getTime())} left). After that your account goes back to Free unless you pick a plan.`
              : trial && trialOffer
                ? `Your trial ended ${fmtEnd(trial.endsAt)}, so you're on Free. The trial price on Expert is still open for a few more days.`
                : stripeTrial && !subscription.cancelAtPeriodEnd
                  ? `Your free trial of ${subscription.plan.name} ends ${subscription.currentPeriodEnd ? fmtEnd(subscription.currentPeriodEnd) : "soon"}, and your first charge is then. To stop it, cancel before then in Manage plan.`
                  : subscription.plan.priceCents > 0
              ? subscription.cancelAtPeriodEnd
                ? `Your ${subscription.plan.name} plan ends ${subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString("en-US", { dateStyle: "medium" }) : "at the end of this period"}.`
                : `You're on ${subscription.plan.name}. Change or cancel any time.`
              : "More credits each month, so research doesn't stop halfway through the week."}
          </p>
          <div className="billing-plans">
            {[FREE_PLAN, ...plans].map((plan) => {
              const isCurrent = subscription.plan.id === plan.id;
              // A trial isn't paid for yet: its card buys the plan rather than managing it.
              const manage = isCurrent && !trialLive;
              const paid = plan.priceCents > 0;
              // With a creator's code: their discount off the full price, nothing else on top.
              const coded = creator && paid && !manage ? Math.round((fullPriceCents(plan) * (100 - creator.discount_percent)) / 100) : null;
              const offered = trialOffer && plan.id === TRIAL_OFFER.planId && coded === null;
              const sale = onSale(plan, now) && !offered && coded === null;
              return (
                <form
                  key={plan.id}
                  action={manage && paid ? openBillingPortal : startSubscription}
                  className="billing-plan"
                  data-plan={plan.id}
                  data-current={isCurrent}
                  data-featured={Boolean(plan.badge)}
                >
                  <input type="hidden" name="planId" value={plan.id} />

                  <div className="billing-plan-head">
                    <h3>{plan.name}</h3>
                    {isCurrent && trialLive ? (
                      <span className="billing-plan-badge" data-tone="current">
                        Trial
                      </span>
                    ) : offered ? (
                      <span className="billing-plan-badge" data-tone="offer">
                        Trial offer
                      </span>
                    ) : isCurrent ? (
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
                    <strong>{coded !== null ? formatPrice(coded) : offered ? formatPrice(TRIAL_OFFER.priceCents) : paid ? formatPrice(priceCentsFor(plan, now)) : "Free"}</strong>
                    {coded !== null ? <span className="billing-plan-was">{formatPrice(fullPriceCents(plan))}</span> : null}
                    {offered ? <span className="billing-plan-was">{formatPrice(priceCentsFor(plan, now))}</span> : null}
                    {sale ? <span className="billing-plan-was">{formatPrice(plan.listPriceCents!)}</span> : null}
                  </div>
                  <span className="billing-plan-terms">
                    {paid ? "per month, billed monthly" : "no card needed"}
                    {offered ? ` · trial price for your first ${TRIAL_OFFER.months} months, then ${formatPrice(priceCentsFor(plan, now))}` : ""}
                    {sale ? ` · launch price until ${SALE_ENDS_LABEL}, then ${formatPrice(plan.listPriceCents!)}` : ""}
                    {coded !== null && creator
                      ? ` · with code ${displayCode(creator.code)} for your first ${creator.discount_months === 1 ? "month" : `${creator.discount_months} months`}, then ${formatPrice(fullPriceCents(plan))}`
                      : ""}
                  </span>

                  {paid || isCurrent ? (
                    <button type="submit" className="billing-plan-cta" disabled={isCurrent && !paid}>
                      {isCurrent && trialLive
                        ? `Keep ${plan.name}`
                        : isCurrent
                          ? paid
                            ? "Manage plan"
                            : "Your plan"
                          : coded !== null && creator
                            ? `Get ${plan.name} ${creator.discount_percent}% off`
                            : offered
                            ? `Get ${plan.name} for ${formatPrice(TRIAL_OFFER.priceCents)}` : PLAN_ORDER.get(plan.id)! < PLAN_ORDER.get(subscription.plan.id)! ? `Switch to ${plan.name}` : `Get ${plan.name}`}
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
          {creator ? (
            <p className="billing-plans-lede" role="status">
              Code <strong>{displayCode(creator.code)}</strong>: {discountLabel(creator)}, applied at checkout.
            </p>
          ) : (
            <CreatorCodeEntry from="billing" error={codeError === "1"} />
          )}
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
      {services.discord.enabled ? (
        <section id="discord" className="card glass billing-discord" aria-label="Discord">
          <div className="billing-discord-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
              <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
            </svg>
          </div>
          <div className="billing-discord-text">
            <strong>Discord</strong>
            {discordLink ? (
              <span className="stat-note">
                Linked to {discordLink.discord_username}. Your server role follows your plan.
              </span>
            ) : (
              <span className="stat-note">Join the Outlier server and get your plan&apos;s role, with the Daily Picks posted every day.</span>
            )}
            {discordResult === "linked" ? <span className="billing-discord-note" data-tone="good">Linked. Welcome to the server.</span> : null}
            {discordResult === "error" ? <span className="billing-discord-note" data-tone="bad">Couldn&apos;t link Discord. Try again.</span> : null}
            {discordResult === "disconnected" ? <span className="billing-discord-note">Disconnected.</span> : null}
          </div>
          {discordLink ? (
            <form action={disconnectDiscord}>
              <button type="submit" className="button-ghost">
                Disconnect
              </button>
            </form>
          ) : (
            <a className="billing-discord-cta" href="/api/discord/connect">
              Connect Discord
            </a>
          )}
        </section>
      ) : null}

      <p className="stat-note">Payments are handled by Stripe. Outlier never sees your card details.</p>
    </div>
  );
}
