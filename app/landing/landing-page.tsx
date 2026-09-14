import Link from "next/link";
import type { ComponentType } from "react";
import { BrandMark, ChartIcon, FlameIcon, ShortsIcon, TrendingIcon, ZapIcon } from "@/components/icons";
import { logger } from "@/lib/core/logger";
import { getServices } from "@/lib/services";
import { WaitlistForm } from "./waitlist-form";

const INSIDE: { icon: ComponentType<{ size?: number }>; label: string }[] = [
  { icon: ShortsIcon, label: "Shorts Channels" },
  { icon: ZapIcon, label: "Realtime growth" },
  { icon: FlameIcon, label: "Trending today" },
  { icon: TrendingIcon, label: "Outlier videos" },
  { icon: ChartIcon, label: "Video analyzer" },
];

/** Hide small numbers rather than advertising an empty waitlist. */
const SHOW_WAITLIST_COUNT_FROM = 25;

async function waitlistCount(): Promise<number> {
  try {
    return await getServices().repositories.waitlist.count();
  } catch (error) {
    // The landing page must render even if the database is unavailable.
    logger.warn("waitlist count unavailable", { error });
    return 0;
  }
}

export async function LandingPage() {
  const count = await waitlistCount();

  return (
    <div className="landing-root">
      <div className="landing-backdrop" aria-hidden="true">
        <div className="landing-grid" />
        <div className="landing-glow landing-glow-a" />
        <div className="landing-glow landing-glow-b" />
      </div>

      <main className="landing-hero">
        <div className="logo-halo" aria-hidden="true">
          <span className="halo-ring halo-ring-1" />
          <span className="halo-ring halo-ring-2" />
          <span className="halo-ring halo-ring-3" />
          <span className="logo-tile">
            <BrandMark size={40} />
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

        <div className="landing-form-wrap">
          <WaitlistForm />
          {count >= SHOW_WAITLIST_COUNT_FROM ? (
            <p className="landing-count">Join {count.toLocaleString()} creators already waiting</p>
          ) : null}
        </div>

        <section className="inside" aria-labelledby="inside-title">
          <h2 id="inside-title" className="inside-title">
            What&apos;s inside
          </h2>
          <ul className="inside-grid">
            {INSIDE.map(({ icon: Icon, label }) => (
              <li key={label} className="inside-item">
                <span className="inside-tile">
                  <Icon size={22} />
                </span>
                <span className="inside-label">{label}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="landing-foot">
        <p>Outlier is launching soon. Built for creators who want to grow faster.</p>
        <p className="landing-foot-links">
          <Link href="/privacy">Privacy</Link>
          <span aria-hidden="true">·</span>
          <span>Not affiliated with YouTube or Google</span>
        </p>
      </footer>
    </div>
  );
}
