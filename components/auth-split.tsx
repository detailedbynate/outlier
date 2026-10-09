import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/icons";

/**
 * The sign-in, reset and signup pages: the form on a dark panel, and a liquid
 * purple panel beside it showing what Outlier looks like inside.
 */
export function AuthSplit({ children }: { children: ReactNode }) {
  return (
    <div className="auth-split">
      <section className="auth-panel">
        <Link href="/" className="brand auth-brand">
          <BrandMark size={30} />
          <span>Outlier</span>
        </Link>
        <div className="auth-panel-body">{children}</div>
        <p className="auth-panel-foot">
          © {new Date().getFullYear()} Outlier ·{" "}
          <Link href="/terms">Terms</Link> ·{" "}
          <Link href="/privacy">Privacy</Link>
        </p>
      </section>
      <AuthVisual />
    </div>
  );
}

function AuthVisual() {
  return (
    <aside className="auth-visual" aria-hidden="true">
      <div className="auth-liquid">
        <span className="auth-blob auth-blob-1" />
        <span className="auth-blob auth-blob-2" />
        <span className="auth-blob auth-blob-3" />
        <span className="auth-blob auth-blob-4" />
        <svg
          className="auth-ribbon"
          viewBox="0 0 600 800"
          preserveAspectRatio="xMidYMid slice"
        >
          <defs>
            <linearGradient id="auth-ribbon-a" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#c4b5fd" />
              <stop offset="0.5" stopColor="#8b5cf6" />
              <stop offset="1" stopColor="#ec4899" />
            </linearGradient>
            <filter
              id="auth-ribbon-glow"
              x="-20%"
              y="-20%"
              width="140%"
              height="140%"
            >
              <feGaussianBlur stdDeviation="14" />
            </filter>
          </defs>
          <path
            className="auth-ribbon-glow"
            d="M640 120 C 420 160, 520 420, 330 470 S 40 520, -40 760"
            stroke="url(#auth-ribbon-a)"
            filter="url(#auth-ribbon-glow)"
          />
          <path
            className="auth-ribbon-line"
            d="M640 120 C 420 160, 520 420, 330 470 S 40 520, -40 760"
            stroke="url(#auth-ribbon-a)"
          />
          <path
            className="auth-ribbon-thin"
            d="M660 300 C 470 300, 470 600, 260 640 S 20 700, -60 860"
            stroke="url(#auth-ribbon-a)"
          />
        </svg>
        <span className="auth-grain" />
      </div>

      <div className="auth-visual-copy">
        <span className="auth-eyebrow">YouTube intelligence</span>
        <h2>Find what&apos;s blowing up before everyone else does.</h2>
        <p>
          Breakout Shorts, rising niches and the videos beating their channel,
          every day.
        </p>
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
            <svg
              className="auth-mock-chart"
              viewBox="0 0 320 110"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="auth-mock-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#8b5cf6" stopOpacity="0.45" />
                  <stop offset="1" stopColor="#8b5cf6" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d="M0 92 C 30 90, 45 80, 70 82 S 110 64, 130 66 S 165 30, 190 34 S 225 52, 245 40 S 290 8, 320 10 L320 110 L0 110Z"
                fill="url(#auth-mock-fill)"
              />
              <path
                className="auth-mock-line"
                d="M0 92 C 30 90, 45 80, 70 82 S 110 64, 130 66 S 165 30, 190 34 S 225 52, 245 40 S 290 8, 320 10"
              />
              <circle cx="245" cy="40" r="4" />
            </svg>
          </div>
        </div>

        <div className="auth-float">
          <span className="auth-float-thumb" />
          <div>
            <strong>Short from a 3K-sub channel</strong>
            <span>1.1M views · 42× its usual</span>
          </div>
        </div>
      </div>

      <div className="auth-visual-foot">
        <span>Daily Picks</span>
        <span>Niche Finder</span>
        <span>Outlier videos</span>
        <span>Scripts</span>
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
