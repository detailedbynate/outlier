import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/icons";
import { env } from "@/lib/core/env";
import { logger } from "@/lib/core/logger";
import { getServices } from "@/lib/services";
import { LandingHeader } from "./landing-header";
import { AnalyzeMock, GrowthMock, PicksMock, ResearchMock } from "./mock-visuals";
import { Reveal } from "./motion";
import { ScrollLink } from "./scroll-link";
import { WaitlistForm } from "./waitlist-form";
import { formatPrice } from "@/lib/billing/packs";
import { onSale, PLANS } from "@/lib/billing/plans";
import { sellablePlans } from "@/lib/billing/subscriptions";
import { startPublicSubscription } from "./checkout";

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

const FEATURES: {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  visual: ReactNode;
}[] = [
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
    visual: <PicksMock />,
  },
  {
    id: "analyze",
    eyebrow: "Video analysis",
    title: "See exactly how far a video beat its channel",
    body: "Paste any video to get views per day, engagement, and an outlier score measured against that channel's recent uploads.",
    points: ["Outlier score vs. channel median", "Views per day and engagement", "Works on Shorts and long-form"],
    visual: <AnalyzeMock />,
  },
];

const FAQ = [
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
    a: "Pro is $10 a month and Expert is $30, both billed monthly and cancellable any time from your account. Pro is a launch price and goes to $15 in October. Every plan has every tool; the difference is how much research you can do each month.",
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

/** Plans, priced straight from the same definitions the app bills against. */
function PricingSection() {
  const sellable = sellablePlans();
  if (sellable.length === 0) return null;
  const now = new Date();
  const shown = [PLANS[0]!, ...sellable];

  return (
    <section id="pricing" className="pricing-section">
      <Reveal>
        <span className="feature-eyebrow">Pricing</span>
        <h2 className="feature-title">Pick a plan, start today</h2>
        <p className="pricing-lede">
          Every plan has every tool. What changes is how much research you can do each month — and you can top up any time.
        </p>
      </Reveal>
      <div className="pricing-grid">
        {shown.map((plan, i) => {
          const sale = onSale(plan, now);
          const paid = plan.priceCents > 0;
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
                  <strong>{paid ? formatPrice(plan.priceCents) : "Free"}</strong>
                  {paid ? <span className="pricing-per">/month</span> : null}
                  {sale ? <span className="pricing-was">{formatPrice(plan.listPriceCents!)}</span> : null}
                </div>
                <span className="pricing-terms">
                  {sale ? `Launch price until 1 October, then ${formatPrice(plan.listPriceCents!)}` : paid ? "Cancel any time" : "No card needed"}
                </span>
                <div className="pricing-credits">
                  <strong>{plan.monthlyCredits.toLocaleString("en-US")} credits a month</strong>
                  <span>{plan.creditsNote}</span>
                </div>
                {paid ? (
                  <button type="submit" className="pill-button pill-button-lg pricing-cta">
                    Get {plan.name}
                  </button>
                ) : (
                  <ScrollLink to="waitlist" className="pill-button pill-button-ghost pill-button-lg">
                    Join the free list
                  </ScrollLink>
                )}
                <ul className="pricing-points">
                  {plan.features.map((feature) => (
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
      <p className="pricing-foot">Payments are handled by Stripe. Subscribing creates your account — we email you a sign-in link straight after.</p>
    </section>
  );
}

export async function LandingPage({ referralCode = null }: { referralCode?: string | null } = {}) {
  const count = await waitlistCount();
  const discordUrl = env().DISCORD_INVITE_URL;

  return (
    <div className="landing-root">
      <div className="landing-backdrop" aria-hidden="true">
        <div className="landing-grid" />
        <div className="landing-glow landing-glow-a" />
        <div className="landing-glow landing-glow-b" />
      </div>

      <LandingHeader />

      <main>
        <section className="landing-hero">
          <div className="logo-halo" aria-hidden="true">
            <span className="halo-ring halo-ring-1" />
            <span className="halo-ring halo-ring-2" />
            <span className="halo-ring halo-ring-3" />
            <span className="logo-tile logo-tile-image">
              <BrandMark size={84} />
            </span>
          </div>

          <p className="landing-eyebrow">Outlier · YouTube intelligence</p>
          <h1 className="landing-title">
            Find your next outlier
            <br />
            <span className="landing-title-accent">before everyone else</span>
          </h1>
          <p className="landing-subtitle">
            Outlier finds the Shorts channels and videos outperforming their size, so you can spot a winning niche while it&apos;s still early.
          </p>

          <div className="landing-cta-row">
            <ScrollLink to="pricing" className="pill-button pill-button-primary pill-button-lg">
              Subscribe now
            </ScrollLink>
            <ScrollLink to="features" className="pill-button pill-button-ghost pill-button-lg">
              See what it does
            </ScrollLink>
          </div>
          <p className="landing-count">From {formatPrice(PLANS[1]!.priceCents)} a month · cancel any time</p>
        </section>

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
          {FEATURES.map((feature, index) => (
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

        <PricingSection />

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
            {FAQ.map((item, i) => (
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

      <footer className="landing-foot">
        <p>Outlier is launching soon. Built for creators who want to grow faster.</p>
        <p className="landing-foot-links">
          <Link href="/terms">Terms</Link>
          <span aria-hidden="true">·</span>
          <Link href="/privacy">Privacy</Link>
          <span aria-hidden="true">·</span>
          <span>Not affiliated with YouTube or Google</span>
        </p>
      </footer>

      {discordUrl ? (
        <a href={discordUrl} target="_blank" rel="noreferrer" className="discord-fab" aria-label="Join the Outlier Discord">
          <DiscordIcon />
          <span className="discord-fab-label">Join our Discord</span>
        </a>
      ) : (
        <span className="discord-fab is-disabled" role="img" aria-label="Discord community coming soon" title="Discord coming soon">
          <DiscordIcon />
          <span className="discord-fab-label">Discord coming soon</span>
        </span>
      )}
    </div>
  );
}
