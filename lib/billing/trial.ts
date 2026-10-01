/**
 * Free trials of a paid plan, given by hand from the Accounts panel.
 *
 * A trial is an ordinary subscriptions row with its own status ("trial") and an
 * end date in `current_period_end`, so everything that reads the plan already
 * honours it, and everything already drops back to Free the moment the end date
 * passes: credits, the Script Writer, the sidebar chip. Nothing has to run at
 * the deadline. The row stays as it is afterwards, which is how we know the
 * trial ended (for the "your trial is over" popup and the Expert offer).
 *
 * Stripe never sees a trial. Buying a plan writes the Stripe subscription over
 * the row, and the trial is gone.
 */

export const TRIAL_STATUS = "trial";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface Trial {
  planId: "pro" | "expert";
  endsAt: string;
  /** When it was given; the row's last write, which is the grant itself. */
  startedAt: string | null;
}

/** Expert at $25 instead of $30 for the first two months, offered to anyone on a trial or just out of one. */
export const TRIAL_OFFER = {
  planId: "expert",
  priceCents: 2_500,
  /** Created in Stripe the first time it's needed (see billing/actions). */
  couponId: "outlier-trial-expert-25-2mo",
  amountOffCents: 500,
  /** Months the discount lasts; then Expert bills at its normal price. */
  months: 2,
  /** How long after the trial ends the offer still stands. */
  graceMs: 7 * DAY,
} as const;

/** Longest trial the panel gives: past this it's a comp, and Set plan is the tool for that. */
export const MAX_TRIAL_MS = 90 * DAY;

export function trialActive(trial: Trial, now: number): boolean {
  return Date.parse(trial.endsAt) > now;
}

/** Can they still buy Expert at the trial price? */
export function offerOpen(trial: Trial | null, now: number): boolean {
  return trial !== null && now < Date.parse(trial.endsAt) + TRIAL_OFFER.graceMs;
}

/**
 * How long between reminders right now, or null when it's too early to remind.
 * Reminders start in the last three days (or the last half of a short trial)
 * and come closer together as the end nears; once it's over, once a day while
 * the offer stands.
 */
export function reminderEvery(trial: Trial, now: number): number | null {
  const left = Date.parse(trial.endsAt) - now;
  if (left <= 0) return offerOpen(trial, now) ? DAY : null;
  const length = trial.startedAt ? Date.parse(trial.endsAt) - Date.parse(trial.startedAt) : Infinity;
  if (left > Math.min(3 * DAY, length / 2)) return null;
  if (left > DAY) return DAY;
  if (left > 6 * HOUR) return 6 * HOUR;
  if (left > HOUR) return HOUR;
  return 15 * 60_000;
}

/** "2 days 4 hours", "5 hours", "40 minutes". */
export function timeLeft(ms: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (ms >= DAY) {
    const days = Math.floor(ms / DAY);
    const hours = Math.floor((ms % DAY) / HOUR);
    return hours ? `${plural(days, "day")} ${plural(hours, "hour")}` : plural(days, "day");
  }
  if (ms >= HOUR) return plural(Math.floor(ms / HOUR), "hour");
  return plural(Math.max(1, Math.ceil(ms / 60_000)), "minute");
}
