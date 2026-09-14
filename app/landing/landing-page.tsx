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
    a: "We're inviting people from the waitlist in small batches. Join with your email and we'll send your invite as soon as your spot opens.",
  },
  {
    q: "How much does it cost?",
    a: "Outlier is a paid subscription. Waitlist members get first access and will hear about launch pricing before anyone else.",
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

export async function LandingPage() {
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
            Join the waitlist for
            <br />
            <span className="landing-title-accent">Outlier</span>
          </h1>
          <p className="landing-subtitle">
            Find the Shorts channels and videos blowing up before everyone else. We&apos;re letting people in in small batches.
          </p>

          <div id="waitlist" className="landing-form-wrap">
            <WaitlistForm />
            {count >= SHOW_WAITLIST_COUNT_FROM ? (
              <p className="landing-count">Join {count.toLocaleString()} creators already waiting</p>
            ) : null}
          </div>
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
          <p>Get on the list now and be one of the first people inside.</p>
          <ScrollLink to="waitlist" className="pill-button pill-button-primary pill-button-lg">
            Join the waitlist
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
