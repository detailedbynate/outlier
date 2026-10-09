import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/icons";

/**
 * The sign-in, reset and signup pages: the form on a dark card, and beside it
 * a black stage with faint rings showing what Outlier looks like inside.
 */
export function AuthSplit({ children, pill, foot }: { children: ReactNode; pill?: string; foot?: ReactNode }) {
  return (
    <div className="auth-split">
      <section className="auth-panel">
        <Link href="/" className="brand auth-brand">
          <BrandMark size={30} />
          <span>Outlier</span>
        </Link>
        <div className="auth-panel-body">
          {pill ? <span className="auth-pill">{pill}</span> : null}
          {children}
        </div>
        {foot ? <p className="auth-panel-foot">{foot}</p> : null}
      </section>
      <AuthVisual />
    </div>
  );
}

const NICHES = [
  ["Minecraft builds", "Roblox obbies", "GTA RP", "Fortnite clips", "Valorant edits", "Horror games", "Speedruns"],
  ["Satisfying edits", "Car builds", "Cooking Shorts", "Football skills", "Retro gaming", "Mobile games", "Map art"],
];

function AuthVisual() {
  return (
    <aside className="auth-visual" aria-hidden="true">
      <div className="auth-rings" />
      <div className="auth-glow" />

      <div className="auth-visual-copy">
        <span className="auth-new">
          <b>New</b> Niche Finder for gaming
        </span>
        <h2>
          Find <span>outliers</span> before everyone else
        </h2>
        <p>Breakout Shorts, rising niches and the videos beating their channel, found for you every day.</p>
      </div>

      <div className="auth-stage">
        <div className="auth-mock">
          <div className="auth-mock-bar">
            <i />
            <i />
            <i />
            <span>useoutlier.online</span>
          </div>
          <div className="auth-mock-body">
            <div className="auth-mock-title">
              <strong>Outliers today</strong>
              <span>Live</span>
            </div>
            <div className="auth-mock-stats">
              <div>
                <small>Views</small>
                <b>2.4M</b>
                <em>+38%</em>
              </div>
              <div>
                <small>Outlier score</small>
                <b>18.2×</b>
                <em>+12%</em>
              </div>
              <div>
                <small>New channels</small>
                <b>1,284</b>
                <em>+6%</em>
              </div>
            </div>
            <svg className="auth-mock-chart" viewBox="0 0 320 110" preserveAspectRatio="none">
              <defs>
                <linearGradient id="auth-mock-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#8b5cf6" stopOpacity="0.45" />
                  <stop offset="1" stopColor="#8b5cf6" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M0 92 C 30 90, 45 80, 70 82 S 110 64, 130 66 S 165 30, 190 34 S 225 52, 245 40 S 290 8, 320 10 L320 110 L0 110Z" fill="url(#auth-mock-fill)" />
              <path className="auth-mock-line" d="M0 92 C 30 90, 45 80, 70 82 S 110 64, 130 66 S 165 30, 190 34 S 225 52, 245 40 S 290 8, 320 10" />
              <circle cx="245" cy="40" r="4" />
            </svg>
          </div>
        </div>

        <div className="auth-chip auth-chip-top">
          <span className="auth-chip-icon">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="4" />
              <path d="m10 9.5 4.5 2.5-4.5 2.5z" />
            </svg>
          </span>
          <div>
            <strong>Live YouTube data</strong>
            <span>Checked every day</span>
          </div>
        </div>

        <div className="auth-chip auth-chip-bottom">
          <span className="auth-float-thumb" />
          <div>
            <strong>Short from a 3K-sub channel</strong>
            <span>1.1M views · 42× its usual</span>
          </div>
        </div>
      </div>

      <div className="auth-marquee">
        {NICHES.map((row, i) => (
          <div key={i} className="auth-marquee-row" data-dir={i % 2 ? "right" : "left"}>
            {[0, 1].map((copy) => (
              <div key={copy} className="auth-marquee-track">
                {row.map((niche) => (
                  <span key={niche} className="auth-marquee-item">
                    <i />
                    {niche}
                  </span>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}

const MailIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="17"
    height="17"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="m4 7 8 6 8-6" />
  </svg>
);

const LockIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="17"
    height="17"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </svg>
);

/** An input with an icon inside it, on the left. */
export function AuthInput({
  icon,
  children,
}: {
  icon: "mail" | "lock";
  children: ReactNode;
}) {
  return (
    <span className="auth-input">
      <span className="auth-input-icon">
        {icon === "mail" ? <MailIcon /> : <LockIcon />}
      </span>
      {children}
    </span>
  );
}
