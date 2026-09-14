/**
 * Momentum for monitored videos: views per hour, acceleration, and how soon to
 * check again. Pure functions, no I/O.
 */

const HOUR = 3_600_000;

export type MonitorPriority = 0 | 1 | 2 | 3;

export const PRIORITY_LABEL: Record<MonitorPriority, string> = { 0: "cold", 1: "normal", 2: "warm", 3: "hot" };

/** Hours until the next check per priority; `null` for cold content means stop monitoring. */
export const CHECK_INTERVAL_HOURS: Record<MonitorPriority, number> = { 3: 1, 2: 3, 1: 12, 0: 72 };

export interface MomentumThresholds {
  /** Views/hour that make a video "hot" regardless of age. */
  hotVph: number;
  /** Views/hour that make a video "warm". */
  warmVph: number;
  /** Videos younger than this are at least "warm" (early hours decide a Short's fate). */
  youngHours: number;
  /** Videos older than this are dropped from monitoring unless still moving. */
  maxAgeDays: number;
  /** Below this, old videos stop being monitored. */
  minVphToKeep: number;
}

export const DEFAULT_THRESHOLDS: MomentumThresholds = {
  hotVph: 2_000,
  warmVph: 200,
  youngHours: 48,
  maxAgeDays: 60,
  minVphToKeep: 20,
};

export interface MomentumInput {
  views: number;
  checkedAt: Date;
  publishedAt: string;
  /** Previous check, when there is one. */
  previous: { views: number; checkedAt: string; viewsPerHour: number | null } | null;
  /** Channel's typical views for one upload; lets a small channel's breakout count as hot. */
  channelMedianViews?: number | null;
}

export interface MomentumResult {
  viewsPerHour: number;
  /** Change in views/hour since the previous check (null on first check). */
  acceleration: number | null;
  priority: MonitorPriority;
  /** null = stop monitoring. */
  nextCheckAt: Date | null;
  /** Views relative to the channel's typical upload. */
  outlierScore: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Views/hour between checks when there's a usable previous check, otherwise lifetime average since upload. */
export function viewsPerHour(input: Pick<MomentumInput, "views" | "checkedAt" | "publishedAt" | "previous">): number {
  const { previous } = input;
  if (previous) {
    const hours = (input.checkedAt.getTime() - Date.parse(previous.checkedAt)) / HOUR;
    // Under ~15 minutes apart the delta is mostly noise.
    if (hours >= 0.25) return round2(Math.max(input.views - previous.views, 0) / hours);
  }
  const ageHours = Math.max((input.checkedAt.getTime() - Date.parse(input.publishedAt)) / HOUR, 1);
  return round2(input.views / ageHours);
}

export function computeMomentum(input: MomentumInput, thresholds: MomentumThresholds = DEFAULT_THRESHOLDS): MomentumResult {
  const vph = viewsPerHour(input);
  const acceleration = input.previous?.viewsPerHour != null ? round2(vph - input.previous.viewsPerHour) : null;
  const ageHours = (input.checkedAt.getTime() - Date.parse(input.publishedAt)) / HOUR;
  const outlierScore = input.channelMedianViews && input.channelMedianViews > 0 ? round2(input.views / input.channelMedianViews) : null;

  // A breakout relative to the channel's own baseline also counts, scaled to its size.
  const channelHourly = input.channelMedianViews ? input.channelMedianViews / (7 * 24) : null;
  const breakout = channelHourly !== null && vph >= Math.max(channelHourly * 5, thresholds.warmVph);
  const accelerating = acceleration !== null && acceleration > 0 && vph >= thresholds.warmVph;

  let priority: MonitorPriority;
  if (vph >= thresholds.hotVph || breakout || (accelerating && ageHours <= thresholds.youngHours)) priority = 3;
  else if (vph >= thresholds.warmVph || ageHours <= thresholds.youngHours) priority = 2;
  else if (ageHours <= 14 * 24) priority = 1;
  else priority = 0;

  const stale = ageHours > thresholds.maxAgeDays * 24 && vph < thresholds.minVphToKeep;
  const nextCheckAt = stale ? null : new Date(input.checkedAt.getTime() + CHECK_INTERVAL_HOURS[priority] * HOUR);
  return { viewsPerHour: vph, acceleration, priority, nextCheckAt, outlierScore };
}

/** Channel priority follows its hottest monitored video; hot channels get hourly stat snapshots. */
export function channelCheckInterval(priority: MonitorPriority): number {
  return { 3: 1, 2: 6, 1: 24, 0: 24 }[priority];
}
