import Link from "next/link";
import type { ReactNode } from "react";
import { CreatorCodeEntry } from "@/components/creator-code-entry";
import { BrandMark } from "@/components/icons";
import { env } from "@/lib/core/env";
import { logger } from "@/lib/core/logger";
import { getServices } from "@/lib/services";
import { LandingHeader } from "./landing-header";
import { AnalyzeMock, GrowthMock, PicksMock, ResearchMock, type ShowcasePick } from "./mock-visuals";
import { Reveal } from "./motion";
import { ScrollLink } from "./scroll-link";
import { WaitlistForm } from "./waitlist-form";
import { formatPrice } from "@/lib/billing/packs";
import { FREE_TRIAL_DAYS, fullPriceCents, onSale, PLANS, SALE_ENDS_LABEL } from "@/lib/billing/plans";
import { priceCentsFor, sellablePlans } from "@/lib/billing/subscriptions";
import { startPublicSubscription } from "./checkout";
import { LaunchVideo } from "./launch-video";
import { TrialOffer } from "./trial-offer";

/** Community invite; DISCORD_INVITE_URL overrides it. */
const DISCORD_INVITE = "https://discord.gg/4SwnX4DR6q";

/** Hide small numbers rather than advertising an empty waitlist. */
const SHOW_WAITLIST_COUNT_FROM = 25;

const NICHES = [
  "cooking hacks",
  "minecraft",
  "personal finance",
  "pets",
  "satisfying",
  "fitness",
  "tech reviews",
  "comedy skits",
  "history facts",
  "skincare",
  "cars",
  "travel",
  "roblox",
  "motivation",
];

function features(picks: ShowcasePick[]): {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  visual: ReactNode;
}[] {
  return [
  {
    id: "features",
    eyebrow: "Shorts research",
    title: "Find breakout Shorts channels in any niche",
    body: "Search a topic and filter by size, average views, channel age, and posting pace to surface the channels quietly winning with Shorts.",
    points: ["Search by niche keywords", "Small channels with big views", "Recent Shorts at a glance"],
    visual: <ResearchMock />,
  },
  {
    id: "realtime",
    eyebrow: "Realtime growth",
    title: "Catch channels in the middle of a breakout",
    body: "Channels are snapshotted throughout the day, so you can sort by the views and subscribers they gained in the last 24 and 48 hours.",
    points: ["Views gained in 24h and 48h", "Subscriber growth", "Fresh snapshots every few hours"],
    visual: <GrowthMock />,
  },
  {
    id: "daily-picks",
    eyebrow: "Daily picks",
    title: "Five breakout channels, picked every day",
    body: "Each day Outlier scans rotating niches and surfaces the channels whose newest Shorts are outperforming their size by the widest margin.",
    points: ["New niches every day", "Ranked by views vs. channel size", "No searching, no credits"],
    visual: <PicksMock picks={picks} />,
  },
  {
    id: "analyze",
    eyebrow: "Video analysis",
    title: "See exactly how far a video beat its channel",
    body: "Paste any video to get views per day, engagement, and an outlier score measured against that channel's recent uploads.",
    points: ["Outlier score vs. channel median", "Views per day and engagement", "Works on Shorts and long-form"],
    visual: <AnalyzeMock pick={picks[0] ?? null} />,
  },
  ];
}

/** Pro's price for a new subscriber today: the launch price during the sale, the list price after. */
function proPrice(): string {
  return formatPrice(priceCentsFor(PLANS[1]!));
}

function why() {
  return [
  {
    title: "Made for Shorts",
    body: "The filters, scores and daily picks are all built around Shorts, where a small channel can go from nothing to millions of views in a week.",
  },
  {
    title: "Measured against the channel",
    body: "200K views means little on its own. Outlier compares every video with what that channel usually gets, so you see what actually overperformed.",
  },
  {
    title: "Fresh numbers",
    body: "Thousands of channels are rechecked throughout the day, so the growth you sort by is hours old, not weeks.",
  },
  {
    title: "Priced for creators",
    body: `Plans start at ${proPrice()} a month and you can cancel any time. Credits you top up never expire.`,
  },
  ];
}

function faq(now: Date) {
  const pro = PLANS[1]!;
  const expert = PLANS[2]!;
  const launch = onSale(pro, now) ? ` Pro is a launch price and goes to ${formatPrice(pro.listPriceCents!)} on ${SALE_ENDS_LABEL}.` : "";
  return [
  {
    q: "What is Outlier?",
    a: "Outlier is a research tool for YouTube creators. It finds channels and videos that are outperforming their size, especially on Shorts, so you can spot winning niches, formats, and ideas early.",
  },
  {
    q: "When can I get in?",
    a: "Straight away. Subscribing creates your account: pick a plan, pay, and we email you a sign-in link within a minute. There's no password to make up.",
  },
  {
    q: "How much does it cost?",
    a: `Pro is ${proPrice()} a month and Expert is ${formatPrice(priceCentsFor(expert, now))}, both billed monthly and cancellable any time from your account.${launch} Free has Shorts Channels; Pro and Expert open every tool, and differ in how much research you can do each month.`,
  },
  {
    q: "Do I need to connect my YouTube account?",
    a: "No. Outlier uses publicly available channel and video statistics, so there's nothing to connect.",
  },
  {
    q: "Is Outlier affiliated with YouTube?",
    a: "No. Outlier is an independent product and isn't affiliated with or endorsed by YouTube or Google.",
  },
  ];
}

async function waitlistCount(): Promise<number> {
  try {
    return await getServices().repositories.waitlist.count();
  } catch (error) {
    // The landing page must render even if the database is unavailable.
    logger.warn("waitlist count unavailable", { error });
    return 0;
  }
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18.2 18.2 0 0 0-5.6 0L8.6 3a19.6 19.6 0 0 0-4.9 1.4C.6 9 0 13.6.3 18.1a19.8 19.8 0 0 0 6 3l1.3-2.1a12.7 12.7 0 0 1-2-1l.5-.4a14 14 0 0 0 11.8 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.7 19.7 0 0 0 6-3c.5-5.2-.8-9.8-3.4-13.7ZM8.5 15.4c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Zm7 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Z" />
    </svg>
  );
}

/** Latest daily picks, biggest outliers first, for the product previews. Empty if unavailable. */
async function showcasePicks(now: Date): Promise<ShowcasePick[]> {
  try {
    const picks = await getServices().trending.currentPicks();
    return picks
      .filter((p) => p.channel_median_views && p.outlier_multiplier && p.video_views > 0)
      .sort((a, b) => b.outlier_multiplier! - a.outlier_multiplier!)
      .map((p) => {
        const days = p.video_published_at ? Math.max(1, (now.getTime() - Date.parse(p.video_published_at)) / 86_400_000) : 1;
        return {
          videoId: p.youtube_video_id,
          title: p.video_title,
          niche: p.niche,
          views: p.video_views,
          medianViews: p.channel_median_views!,
          multiplier: p.outlier_multiplier!,
          viewsPerDay: Math.round(p.video_views / days),
          engagement: p.engagement,
        };
      });
  } catch (error) {
    // The landing page must render even if the database is unavailable.
    logger.warn("landing showcase picks unavailable", { error });
    return [];
  }
}

const monthsLabel = (months: number) => (months === 1 ? "first month" : `first ${months} months`);

/** What a plan costs with a creator's code, in cents. */
const withCode = (cents: number, code: LandingCreatorCode) => Math.round((cents * (100 - code.percent)) / 100);

/**
 * Plans, priced straight from the same definitions the app bills against. With
 * a creator's code the cards show what the visitor will actually pay.
 */
function PricingSection({ code = null, focused = false, codeError = false }: { code?: LandingCreatorCode | null; focused?: boolean; codeError?: boolean }) {
  const sellable = sellablePlans();
  if (sellable.length === 0) return null;
  const now = new Date();
  // Someone sent here to buy doesn't need the free plan in the way.
  const shown = focused ? sellable : [PLANS[0]!, ...sellable];

  return (
    <section id="pricing" className="pricing-section">
      <Reveal>
        <span className="feature-eyebrow">Pricing</span>
        <h2 className="feature-title">{code ? `Your ${code.percent}% off is ready` : "Pick a plan, start today"}</h2>
        <p className="pricing-lede">
          {code
            ? `${code.creatorName}'s code ${code.code} takes ${code.percent}% off your ${monthsLabel(code.months)}. It's already applied, so just pick a plan.`
            : focused
              ? "Pro and Expert both open every tool. They differ in how much research you can do each month, and you can top up any time."
              : "Free gets you Shorts Channels. Pro and Expert open every tool, and differ in how much research you can do each month — and you can top up any time."}
        </p>
      </Reveal>
      <div className="pricing-grid">
        {shown.map((plan, i) => {
          const sale = onSale(plan, now);
          const paid = plan.priceCents > 0;
          const base = priceCentsFor(plan, now);
          // A code's discount comes off the full price; there's no launch sale on top.
          const full = fullPriceCents(plan);
          const coded = paid && code ? withCode(full, code) : null;
          return (
            <Reveal key={plan.id} delay={i * 80}>
              <form action={startPublicSubscription} className="pricing-card" data-plan={plan.id} data-featured={Boolean(plan.badge)}>
                <input type="hidden" name="planId" value={plan.id} />
                <div className="pricing-card-head">
                  <h3>{plan.name}</h3>
                  {plan.badge ? <span className="pricing-badge">{plan.badge}</span> : null}
                </div>
                <p className="pricing-blurb">{plan.blurb}</p>
                <div className="pricing-price">
                  <strong>{coded !== null ? formatPrice(coded) : paid ? formatPrice(base) : "Free"}</strong>
                  {paid ? <span className="pricing-per">/month</span> : null}
                  {coded !== null ? (
                    <span className="pricing-was">{formatPrice(full)}</span>
                  ) : sale ? (
                    <span className="pricing-was">{formatPrice(plan.listPriceCents!)}</span>
                  ) : null}
                </div>
                {coded !== null && code ? (
                  <span className="pricing-terms pricing-terms-code">
                    With code {code.code} for your {monthsLabel(code.months)}, then {formatPrice(full)}/month
                  </span>
                ) : sale || !paid ? (
                  <span className="pricing-terms">{sale ? `Launch price until ${SALE_ENDS_LABEL}, then ${formatPrice(plan.listPriceCents!)}` : "No card needed"}</span>
                ) : null}
                <div className="pricing-credits">
                  <strong>{plan.monthlyCredits.toLocaleString("en-US")} credits a month</strong>
                  <span>{plan.creditsNote}</span>
                </div>
                {paid ? (
                  <>
                    <button type="submit" className="pill-button pill-button-lg pricing-cta">
                      {code ? `Get ${plan.name} ${code.percent}% off` : `Get ${plan.name}`}
                    </button>
                    <span className="pricing-cancel">Cancel any time</span>
                  </>
                ) : (
                  <ScrollLink to="waitlist" className="pill-button pill-button-ghost pill-button-lg">
                    Join the free list
                  </ScrollLink>
                )}
                <ul className="pricing-points">
                  {/* "Cancel any time" already sits under the button. */}
                  {plan.features.filter((feature) => feature !== "Cancel any time").map((feature) => (
                    <li key={feature}>
                      <CheckIcon />
                      {feature}
                    </li>
                  ))}
                </ul>
              </form>
            </Reveal>
          );
        })}
      </div>
      {code ? null : <CreatorCodeEntry from="landing" error={codeError} />}
      <p className="pricing-foot">
        Payments are handled by Stripe. Subscribing creates your account — we email you a sign-in link straight after. It renews
        monthly until you cancel; see our <Link href="/terms">Terms</Link> and <Link href="/refunds">Refund Policy</Link>.
      </p>
    </section>
  );
}

/** A creator's code the visitor came in with: shown in the hero, applied at checkout. */
export interface LandingCreatorCode {
  code: string;
  creatorName: string;
  offer: string;
  percent: number;
  months: number;
}

function trialPlans(now: Date, code: LandingCreatorCode | null) {
  return sellablePlans().map((plan) => ({
    id: plan.id as "pro" | "expert",
    name: plan.name,
    // With a creator's code it's their discount off the full price, with no launch sale.
    price: formatPrice(code ? fullPriceCents(plan) : priceCentsFor(plan, now)),
    was: !code && onSale(plan, now) ? formatPrice(plan.listPriceCents!) : null,
    codePrice: code ? formatPrice(withCode(fullPriceCents(plan), code)) : null,
  }));
}

function popupCode(code: LandingCreatorCode | null) {
  return code ? { code: code.code, creatorName: code.creatorName, percent: code.percent, months: code.months } : null;
}

/** The floating Discord button, bottom corner. */
function DiscordFab() {
  const discordUrl = env().DISCORD_INVITE_URL ?? DISCORD_INVITE;
  return discordUrl ? (
    <a href={discordUrl} target="_blank" rel="noreferrer" className="discord-fab" aria-label="Join the Outlier Discord">
      <DiscordIcon />
      <span className="discord-fab-label">Join our Discord</span>
    </a>
  ) : (
    <span className="discord-fab is-disabled" role="img" aria-label="Discord community coming soon" title="Discord coming soon">
      <DiscordIcon />
      <span className="discord-fab-label">Discord coming soon</span>
    </span>
  );
}

function LandingFooter() {
  return (
    <footer className="landing-foot">
      <p>Outlier is launching soon. Built for creators who want to grow faster.</p>
      <p className="landing-foot-links">
        <Link href="/terms">Terms</Link>
        <span aria-hidden="true">·</span>
        <Link href="/privacy">Privacy</Link>
        <span aria-hidden="true">·</span>
        <Link href="/refunds">Refunds</Link>
        <span aria-hidden="true">·</span>
        <span>Not affiliated with YouTube or Google</span>
      </p>
    </footer>
  );
}

/**
 * For visitors a creator or friend sent: they've already heard what Outlier
 * does, so it's the pitch, the offer, the video and straight to the plans.
 */
function FocusedLanding({ creatorCode, codeError }: { creatorCode: LandingCreatorCode | null; codeError: boolean }) {
  const now = new Date();
  const code = creatorCode;
  const plans = sellablePlans();
  const cheapest = plans.length > 0 ? Math.min(...plans.map((plan) => (code ? fullPriceCents(plan) : priceCentsFor(plan, now)))) : null;

  return (
    <div className="landing-root landing-focused">
      <div className="landing-backdrop" aria-hidden="true" />

      <LandingHeader minimal />

      <main>
        <section className="landing-hero">
          <div className="logo-halo" aria-hidden="true">
            <span className="logo-tile logo-tile-image">
              <BrandMark size={84} />
            </span>
          </div>

          {code ? (
            <p className="landing-gift" role="status">
              <span className="landing-gift-tag">{code.percent}% off</span>
              <span>
                <strong>{code.creatorName}</strong> sent you a discount
              </span>
            </p>
          ) : null}

          <h1 className="landing-title">
            Find your next outlier
            <br />
            before everyone else
          </h1>
          <p className="landing-subtitle">
            Outlier finds the Shorts channels and videos outperforming their size, so you can spot a winning niche while it&apos;s still early.
          </p>

          {code ? (
            <p className="landing-creator-code">
              Code <strong>{code.code}</strong>: {code.offer} on Pro or Expert
              {cheapest !== null ? (
                <>
                  , from <strong>{formatPrice(withCode(cheapest, code))}/month</strong>
                </>
              ) : null}
              . Applied automatically at checkout.
            </p>
          ) : null}

          <div className="landing-cta-row">
            <ScrollLink to="pricing" className="pill-button pill-button-primary pill-button-lg">
              {code ? `Claim ${code.percent}% off` : "See plans"}
            </ScrollLink>
          </div>
          <p className="landing-reassure">Cancel any time · Every tool included · Secure checkout by Stripe</p>
        </section>

        <LaunchVideo />

        <PricingSection code={code} focused codeError={codeError} />
      </main>

      <TrialOffer days={FREE_TRIAL_DAYS} plans={trialPlans(now, code)} code={popupCode(code)} />

      <LandingFooter />

      <DiscordFab />
    </div>
  );
}

export async function LandingPage({
  referralCode = null,
  creatorCode = null,
  focused = false,
  codeError = false,
}: { referralCode?: string | null; creatorCode?: LandingCreatorCode | null; focused?: boolean; codeError?: boolean } = {}) {
  if (focused) return <FocusedLanding creatorCode={creatorCode} codeError={codeError} />;
  const [count, picks] = await Promise.all([waitlistCount(), showcasePicks(new Date())]);
  return (
    <div className="landing-root">
      <div className="landing-backdrop" aria-hidden="true" />

      <LandingHeader />

      <main>
        <section className="landing-hero">
          <div className="logo-halo" aria-hidden="true">
            <span className="logo-tile logo-tile-image">
              <BrandMark size={84} />
            </span>
          </div>

          <h1 className="landing-title">
            Find your next outlier
            <br />
            before everyone else
          </h1>
          <p className="landing-subtitle">
            Outlier finds the Shorts channels and videos outperforming their size, so you can spot a winning niche while it&apos;s still early.
          </p>

          {creatorCode ? (
            <p className="landing-creator-code" role="status">
              Code <strong>{creatorCode.code}</strong> from {creatorCode.creatorName}: {creatorCode.offer} on any paid plan. It&apos;s applied at checkout.
            </p>
          ) : null}

          <div className="landing-cta-row">
            <ScrollLink to="pricing" className="pill-button pill-button-primary pill-button-lg">
              Subscribe now
            </ScrollLink>
            <ScrollLink to="features" className="pill-button pill-button-ghost pill-button-lg">
              See what it does
            </ScrollLink>
          </div>
        </section>

        <LaunchVideo />

        <div className="marquee" aria-hidden="true">
          <div className="marquee-track">
            {[...NICHES, ...NICHES].map((niche, i) => (
              <span key={`${niche}-${i}`} className="marquee-item">
                {niche}
              </span>
            ))}
          </div>
        </div>

        <div className="feature-sections">
          {features(picks).map((feature, index) => (
            <section key={feature.id} id={feature.id} className={`feature-row ${index % 2 === 1 ? "is-flipped" : ""}`}>
              <Reveal className="feature-copy">
                <span className="feature-eyebrow">{feature.eyebrow}</span>
                <h2 className="feature-title">{feature.title}</h2>
                <p className="feature-body">{feature.body}</p>
                <ul className="feature-points">
                  {feature.points.map((point) => (
                    <li key={point}>
                      <CheckIcon />
                      {point}
                    </li>
                  ))}
                </ul>
              </Reveal>
              <Reveal className="feature-visual" delay={120}>
                {feature.visual}
              </Reveal>
            </section>
          ))}
        </div>

        <section id="why" className="why-section">
          <Reveal>
            <span className="feature-eyebrow">Why Outlier</span>
            <h2 className="feature-title">Why choose Outlier</h2>
          </Reveal>
          <div className="why-grid">
            {why().map((item, i) => (
              <Reveal key={item.title} delay={i * 60} className="why-item">
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </Reveal>
            ))}
          </div>
        </section>

        <PricingSection code={creatorCode} codeError={codeError} />

        <section id="waitlist" className="landing-list-section">
          <Reveal className="landing-list-inner">
            <h2 className="feature-title">Not ready to subscribe?</h2>
            <p className="pricing-lede">Leave your email and we&apos;ll tell you when something worth knowing about ships.</p>
            <div className="landing-form-wrap">
              <WaitlistForm referralCode={referralCode} />
              {count >= SHOW_WAITLIST_COUNT_FROM ? (
                <p className="landing-count">{count.toLocaleString()} creators already on the list</p>
              ) : null}
            </div>
          </Reveal>
        </section>

        <section id="faq" className="faq-section">
          <Reveal>
            <span className="feature-eyebrow">FAQ</span>
            <h2 className="feature-title">Questions, answered</h2>
          </Reveal>
          <div className="faq-list">
            {faq(new Date()).map((item, i) => (
              <Reveal key={item.q} delay={i * 60}>
                <details className="faq-item">
                  <summary>
                    <span>{item.q}</span>
                    <span className="faq-toggle" aria-hidden="true" />
                  </summary>
                  <p>{item.a}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </section>

        <Reveal className="final-cta">
          <h2>Ready to find your next outlier?</h2>
          <p>Pick a plan and start researching today.</p>
          <ScrollLink to="pricing" className="pill-button pill-button-primary pill-button-lg">
            Subscribe now
          </ScrollLink>
        </Reveal>
      </main>

      <TrialOffer days={FREE_TRIAL_DAYS} plans={trialPlans(new Date(), creatorCode)} code={popupCode(creatorCode)} />

      <LandingFooter />

      <DiscordFab />
    </div>
  );
}
