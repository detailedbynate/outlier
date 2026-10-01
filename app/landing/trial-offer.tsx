"use client";

import { useEffect, useState } from "react";
import { startPublicSubscription } from "./checkout";

export interface TrialOfferPlan {
  id: "pro" | "expert";
  name: string;
  price: string;
  /** Struck through while the launch price runs. */
  was: string | null;
}

/** A dismissed offer stays away this long in this browser. */
const QUIET_MS = 3 * 24 * 3_600_000;
const KEY = "outlier:trial-offer-dismissed";

/**
 * The free-trial deal on the landing page. The page itself sells plans at full
 * price; after someone has been reading for 10-15 seconds this offers them the
 * first days free. Only checkout from here starts with the trial.
 */
export function TrialOffer({ days, plans }: { days: number; plans: TrialOfferPlan[] }) {
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState<TrialOfferPlan["id"]>("pro");

  useEffect(() => {
    try {
      if (Date.now() - Number(window.localStorage.getItem(KEY) ?? 0) < QUIET_MS) return;
    } catch {
      // Storage blocked: the offer shows once per visit instead.
    }
    let left = 10_000 + Math.random() * 5_000;
    let last = Date.now();
    // Count only time the page is actually being looked at.
    const timer = setInterval(() => {
      const now = Date.now();
      if (!document.hidden) left -= now - last;
      last = now;
      if (left <= 0) {
        clearInterval(timer);
        setOpen(true);
      }
    }, 500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!open || plans.length === 0) return null;
  const plan = plans.find((p) => p.id === planId) ?? plans[0]!;

  function dismiss() {
    try {
      window.localStorage.setItem(KEY, String(Date.now()));
    } catch {
      // Nothing to remember it in.
    }
    setOpen(false);
  }

  return (
    <div className="sw-modal-scrim trial-offer-scrim" onClick={dismiss}>
      <div className="paywall-modal" role="dialog" aria-modal="true" aria-labelledby="trial-offer-title" tabIndex={-1} autoFocus onClick={(e) => e.stopPropagation()}>
        <div className="paywall-hero" aria-hidden="true">
          <div className="paywall-hero-bars">
            {[22, 30, 18, 100, 26, 24, 20].map((h, i) => (
              <span key={i} data-peak={h === 100 ? "" : undefined} style={{ height: `${h}%` }} />
            ))}
          </div>
          <span className="paywall-hero-chip">18× usual views</span>
        </div>
        <form action={startPublicSubscription} className="paywall-modal-body">
          <h2 id="trial-offer-title">Try Outlier free for {days} days</h2>
          <p className="paywall-modal-sub">Every tool, the Script Writer and a full month&apos;s credits. Cancel before the trial ends and you pay nothing.</p>

          {plans.length > 1 ? (
            <div className="trial-offer-plans" role="radiogroup" aria-label="Plan">
              {plans.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={p.id === plan.id} onClick={() => setPlanId(p.id)}>
                  <strong>{p.name}</strong>
                  <span>
                    {p.was ? <s>{p.was}</s> : null} {p.price}/mo
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <input type="hidden" name="planId" value={plan.id} />
          <input type="hidden" name="trial" value="1" />
          <button type="submit" className="paywall-cta trial-offer-cta">
            Start my free trial
          </button>
          <p className="paywall-price-note paywall-then">
            Then
            {plan.was ? (
              <span className="paywall-was">
                <span className="sr-only">was </span>
                {plan.was}
              </span>
            ) : null}
            <span className="paywall-now">{plan.price}/mo</span>
            <span>Card needed. Nothing is charged for {days} days.</span>
          </p>
          <button type="button" className="paywall-later" onClick={dismiss}>
            No thanks
          </button>
        </form>
      </div>
    </div>
  );
}
