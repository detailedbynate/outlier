"use client";

import { useEffect, useState } from "react";
import { startPublicSubscription } from "./checkout";

export interface TrialOfferPlan {
  id: "pro" | "expert";
  name: string;
  price: string;
  /** Struck through while the launch price runs. */
  was: string | null;
  /** The price with the visitor's creator code, when they have one. */
  codePrice?: string | null;
}

/** A creator's code the visitor came in with. */
export interface TrialOfferCode {
  code: string;
  creatorName: string;
  percent: number;
  months: number;
}

/** A dismissed offer stays away this long in this browser. */
const QUIET_MS = 3 * 24 * 3_600_000;
const CODE_QUIET_MS = 24 * 3_600_000;
const KEY = "outlier:trial-offer-dismissed";

/**
 * The deal on the landing page, offered after someone has been reading for a
 * few seconds. Normally it's the first days free (only checkout from here
 * starts with the trial). Someone who came in on a creator's code gets their
 * code's discount instead: it's what the creator promised them, and it's
 * what the creator is paid on.
 */
export function TrialOffer({ days, plans, code = null }: { days: number; plans: TrialOfferPlan[]; code?: TrialOfferCode | null }) {
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState<TrialOfferPlan["id"]>("pro");
  const key = code ? `outlier:code-offer-dismissed:${code.code}` : KEY;

  useEffect(() => {
    try {
      if (Date.now() - Number(window.localStorage.getItem(key) ?? 0) < (code ? CODE_QUIET_MS : QUIET_MS)) return;
    } catch {
      // Storage blocked: the offer shows once per visit instead.
    }
    // Someone sent by a creator is already warm: offer sooner.
    let left = code ? 6_000 + Math.random() * 3_000 : 10_000 + Math.random() * 5_000;
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
  }, [key, code]);

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
  const months = code ? (code.months === 1 ? "first month" : `first ${code.months} months`) : "";

  function dismiss() {
    try {
      window.localStorage.setItem(key, String(Date.now()));
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
          <span className="paywall-hero-chip">{code ? `Code ${code.code}` : "18× usual views"}</span>
        </div>
        <form action={startPublicSubscription} className="paywall-modal-body">
          {code ? <input type="hidden" name="withCode" value="1" /> : null}
          {code ? (
            <>
              <h2 id="trial-offer-title">
                {code.creatorName} got you {code.percent}% off
              </h2>
              <p className="paywall-modal-sub">
                {code.percent}% off your {months} of Pro or Expert with code {code.code}. Every tool, the Script Writer and a full month&apos;s credits. Cancel any time.
              </p>
            </>
          ) : (
            <>
              <h2 id="trial-offer-title">Try Outlier free for {days} days</h2>
              <p className="paywall-modal-sub">Every tool, the Script Writer and a full month&apos;s credits. Cancel before the trial ends and you pay nothing.</p>
            </>
          )}

          {plans.length > 1 ? (
            <div className="trial-offer-plans" role="radiogroup" aria-label="Plan">
              {plans.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={p.id === plan.id} onClick={() => setPlanId(p.id)}>
                  <strong>{p.name}</strong>
                  <span>
                    {code && p.codePrice ? (
                      <>
                        <s>{p.price}</s> {p.codePrice}/mo
                      </>
                    ) : (
                      <>
                        {p.was ? <s>{p.was}</s> : null} {p.price}/mo
                      </>
                    )}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <input type="hidden" name="planId" value={plan.id} />
          {code ? null : <input type="hidden" name="trial" value="1" />}
          <button type="submit" className="paywall-cta trial-offer-cta">
            {code ? `Claim ${code.percent}% off ${plan.name}` : "Start my free trial"}
          </button>
          {code && plan.codePrice ? (
            <p className="paywall-price-note paywall-then">
              <span className="paywall-now">{plan.codePrice}/mo</span>
              <span>
                for your {months}, then {plan.price}/mo. Applied automatically at checkout.
              </span>
            </p>
          ) : (
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
          )}
          <button type="button" className="paywall-later" onClick={dismiss}>
            No thanks
          </button>
        </form>
      </div>
    </div>
  );
}
