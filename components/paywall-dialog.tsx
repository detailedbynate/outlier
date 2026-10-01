"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FeatureCopy } from "@/lib/billing/features";
import { CheckIcon, LockIcon } from "./icons";

/**
 * A paid tool, seen from the Free plan: the page's shape behind a blur, and a
 * dialog saying what it does and where to get it. Open on arrival, because
 * clicking the menu item was the question; closing it leaves the preview, and
 * the badge brings it back. Nothing here is the gate: the page never loaded
 * the tool's data in the first place.
 */
export interface PaywallPrice {
  now: string;
  /** The price after the launch sale, shown struck through while it runs. */
  was: string | null;
  until: string | null;
  /** Days free before the first charge, when they haven't subscribed before. */
  trialDays: number | null;
}

export function PaywallDialog({ feature, price }: { feature: FeatureCopy; price: PaywallPrice }) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!open) return;
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
          <div className="paywall-modal" role="dialog" aria-modal="true" aria-labelledby="paywall-title" tabIndex={-1} autoFocus onClick={(event) => event.stopPropagation()}>
            <OutlierBars />
            <div className="paywall-modal-body">
              <h2 id="paywall-title">{feature.hook}</h2>
              <p className="paywall-modal-sub">{feature.title} is part of Pro, with every other tool and the Script Writer.</p>
              <ul className="paywall-points">
                {feature.points.map((point) => (
                  <li key={point}>
                    <CheckIcon size={15} />
                    {point}
                  </li>
                ))}
              </ul>
              {price.trialDays ? (
                <>
                  <Link href="/billing" className="paywall-cta">
                    Try Pro free for {price.trialDays} days
                  </Link>
                  <p className="paywall-price-note paywall-then">
                    Then
                    {price.was ? (
                      <span className="paywall-was">
                        <span className="sr-only">was </span>
                        {price.was}
                      </span>
                    ) : null}
                    <span className="paywall-now">{price.now}/mo</span>
                    <span>Cancel before it ends and you pay nothing.</span>
                  </p>
                </>
              ) : (
                <>
                  <Link href="/billing" className="paywall-cta">
                    Get Pro for
                    {price.was ? (
                      <span className="paywall-was">
                        <span className="sr-only">was </span>
                        {price.was}
                      </span>
                    ) : null}
                    <span className="paywall-now">
                      {price.was ? <span className="sr-only">now </span> : null}
                      {price.now}/mo
                    </span>
                  </Link>
                  <p className="paywall-price-note">{price.was ? `Launch price until ${price.until}. ` : ""}Cancel any time.</p>
                </>
              )}
              <button type="button" className="paywall-later" onClick={() => setOpen(false)}>
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

/** The idea of Outlier in one picture: one upload towering over the channel's usual. */
function OutlierBars() {
  const bars = [22, 30, 18, 100, 26, 24, 20];
  return (
    <div className="paywall-hero" aria-hidden="true">
      <div className="paywall-hero-bars">
        {bars.map((h, i) => (
          <span key={i} data-peak={h === 100 ? "" : undefined} style={{ height: `${h}%` }} />
        ))}
      </div>
      <span className="paywall-hero-chip">18× usual views</span>
    </div>
  );
}
