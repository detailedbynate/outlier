"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { startSubscription } from "@/app/billing/actions";
import { timeLeft } from "@/lib/billing/trial";
import { ClockIcon } from "./icons";

/** Matches the exit transition in globals.css. */
const EXIT_MS = 260;
/** Wait for the page to finish drawing before coming in. */
const SETTLE_MS = 900;
/** How often an open tab checks whether the next reminder is due. */
const CHECK_MS = 60_000;

export interface TrialReminderProps {
  planName: string;
  endsAt: string;
  /** Time between reminders, from lib/billing/trial; it shortens as the end nears. */
  everyMs: number;
  /** The Expert trial price, when they can still get it. */
  offer: { price: string; was: string; months: number; until: string } | null;
}

/**
 * Reminds someone on a free trial that it's running out, more often the closer
 * it gets, and once a day after it's over while the trial price still stands.
 * When it last showed is kept in this browser; a cleared browser just sees it
 * a little sooner.
 */
export function TrialReminder({ planName, endsAt, everyMs, offer }: TrialReminderProps) {
  const pathname = usePathname();
  const key = `outlier:trial-reminder:${endsAt}`;
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"in" | "out">("in");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (pathname.startsWith("/billing")) return;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const due = () => {
      let last = 0;
      try {
        last = Number(window.localStorage.getItem(key)) || 0;
      } catch {
        // Storage blocked: it shows on each full page load instead.
      }
      return Date.now() - last >= everyMs;
    };
    const check = () => {
      if (document.hidden || !due()) return;
      try {
        window.localStorage.setItem(key, String(Date.now()));
      } catch {
        // Nothing to remember it in.
      }
      setNow(Date.now());
      setPhase("in");
      setOpen(true);
    };
    const start = () => {
      settle = setTimeout(check, SETTLE_MS);
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    // A tab left open still gets the next reminder when it's due.
    const timer = setInterval(check, CHECK_MS);
    return () => {
      window.removeEventListener("load", start);
      clearTimeout(settle);
      clearInterval(timer);
    };
  }, [key, everyMs, pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!open) return null;

  function close() {
    if (phase === "out") return;
    setPhase("out");
    setTimeout(() => setOpen(false), EXIT_MS);
  }

  const left = Date.parse(endsAt) - now;
  const ended = left <= 0;
  const urgency = ended ? "ended" : left <= 6 * 3_600_000 ? "urgent" : "soon";
  const endDate = new Date(endsAt).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <div className="whats-new-backdrop" data-phase={phase} role="presentation" onClick={close}>
      <div className="low-credits whats-new trial-reminder" data-urgency={urgency} role="dialog" aria-modal="true" aria-labelledby="trial-reminder-title" onClick={(e) => e.stopPropagation()}>
        <span className="whats-new-badge trial-reminder-badge">
          <ClockIcon size={14} /> {ended ? "Trial over" : `${timeLeft(left)} left`}
        </span>
        <h2 id="trial-reminder-title">{ended ? `Your ${planName} trial has ended` : `Your ${planName} trial ends in ${timeLeft(left)}`}</h2>
        <p>
          {ended
            ? `Your account is back on Free, which has Shorts Channels only. Pick a plan to get every tool back and carry on where you left off.`
            : `On ${endDate} your account goes back to Free, which has Shorts Channels only. Buy a plan before then to keep every tool without a gap.`}
        </p>
        {offer ? (
          <div className="trial-offer">
            <span className="trial-offer-label">Trial offer</span>
            <strong>
              Expert for {offer.price}/mo <s>{offer.was}</s>
            </strong>
            <span>
              For your first {offer.months} months, then {offer.was}. Open until {offer.until}.
            </span>
          </div>
        ) : null}
        <div className="low-credits-actions trial-reminder-actions">
          <button type="button" className="button-ghost" onClick={close}>
            {ended ? "Not now" : "Remind me later"}
          </button>
          <Link href="/billing" className="button-ghost trial-reminder-plans" onClick={close}>
            See plans
          </Link>
          {offer ? (
            <form action={startSubscription}>
              <input type="hidden" name="planId" value="expert" />
              <button type="submit" className="low-credits-cta whats-new-cta" autoFocus>
                Get Expert for {offer.price}
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
