"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FeatureCopy } from "@/lib/billing/features";
import { LockIcon, ShortsIcon } from "./icons";

/**
 * A paid tool, seen from the Free plan: the page's shape behind a blur, and a
 * dialog saying what it does and where to get it. Open on arrival, because
 * clicking the menu item was the question; closing it leaves the preview, and
 * the badge brings it back. Nothing here is the gate: the page never loaded
 * the tool's data in the first place.
 */
export function Paywall({ feature }: { feature: FeatureCopy }) {
  const [open, setOpen] = useState(true);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="dash paywall">
      <header className="dash-hero">
        <div className="dash-hero-text">
          <span className="dash-eyebrow">
            <LockIcon size={13} /> Pro feature
          </span>
          <h1>{feature.title}</h1>
          <p>{feature.pitch}</p>
        </div>
      </header>

      <div className="sw-lock">
        <div className="sw-lock-preview" aria-hidden="true" inert>
          <PaywallPreview />
        </div>
        <button type="button" className="sw-lock-hit" onClick={() => setOpen(true)}>
          <span className="sw-lock-badge">
            <LockIcon size={14} /> Unlock with Pro
          </span>
          <span className="sr-only">{feature.title} is on Pro and above. See what it does.</span>
        </button>
      </div>

      {open ? (
        <div className="sw-modal-scrim" onClick={() => setOpen(false)}>
          <div className="sw-modal paywall-modal" role="dialog" aria-modal="true" aria-labelledby="paywall-title" onClick={(event) => event.stopPropagation()}>
            <span className="sw-modal-icon">
              <LockIcon size={20} />
            </span>
            <h2 id="paywall-title">{feature.title} is on Pro</h2>
            <p>{feature.pitch}</p>
            <ul className="paywall-points">
              {feature.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <p className="sw-modal-note">Free includes Shorts Channels. Pro opens every tool, plus the Script Writer.</p>
            <div className="paywall-actions">
              <Link href="/billing" className="low-credits-cta paywall-cta">
                See plans
              </Link>
              <Link href="/research/shorts-channels" className="paywall-free-link">
                <ShortsIcon size={14} /> Go to Shorts Channels
              </Link>
              <button type="button" className="sw-modal-dismiss" onClick={() => setOpen(false)} ref={closeRef}>
                Not now
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A made-up page of numbers, charts and rows: the shape of a tool, nothing real. */
function PaywallPreview() {
  const bars = [38, 52, 44, 61, 57, 73, 66, 82, 77, 91, 86, 100];
  const rows = [
    ["Why nobody talks about this", "2.4M", "18.2×"],
    ["I tried it for 30 days", "1.1M", "9.6×"],
    ["The 3 second rule", "864K", "7.1×"],
    ["Don't make this mistake", "512K", "4.8×"],
    ["This changed everything", "301K", "3.2×"],
  ];
  return (
    <div className="paywall-preview">
      <div className="paywall-tiles">
        {[
          ["Views (30d)", "4.8M"],
          ["Subscribers", "+12.4K"],
          ["Breakouts", "17"],
          ["Score", "84"],
        ].map(([label, value]) => (
          <div key={label} className="paywall-tile">
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="paywall-chart">
        {bars.map((h, i) => (
          <span key={i} style={{ height: `${h}%` }} />
        ))}
      </div>
      <div className="paywall-rows">
        {rows.map(([title, views, x]) => (
          <div key={title} className="paywall-row">
            <span className="paywall-thumb" />
            <span className="paywall-row-title">{title}</span>
            <span>{views}</span>
            <strong>{x}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
