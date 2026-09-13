/**
 * Pure performance metrics. No I/O — safe to reuse in jobs, API responses,
 * SQL backfills (as reference), and tests.
 */

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

export interface SnapshotPoint {
  capturedAt: string | Date;
  value: number;
}

function toMs(value: string | Date): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Age in fractional days, floored at one hour so brand-new videos don't explode per-day rates. */
export function ageInDays(publishedAt: string | Date, now: Date = new Date()): number {
  const ageMs = Math.max(now.getTime() - toMs(publishedAt), MS_PER_HOUR);
  return ageMs / MS_PER_DAY;
}

export function viewsPerDay(viewCount: number, publishedAt: string | Date, now: Date = new Date()): number {
  if (!Number.isFinite(viewCount) || viewCount <= 0) return 0;
  return round(viewCount / ageInDays(publishedAt, now), 4);
}

/** (likes + comments) / views. Null when views are zero or both signals are hidden. */
export function engagementRate(viewCount: number, likeCount: number | null, commentCount: number | null): number | null {
  if (viewCount <= 0 || (likeCount === null && commentCount === null)) return null;
  return round(((likeCount ?? 0) + (commentCount ?? 0)) / viewCount, 6);
}

export function median(values: readonly number[]): number | null {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * How many times more views a video has than the channel's typical video.
 * 1.0 = typical, 5.0 = 5x outlier. Null without a baseline.
 */
export function outlierScore(viewCount: number, channelMedianViews: number | null): number | null {
  if (channelMedianViews === null || channelMedianViews <= 0) return null;
  return round(Math.max(viewCount, 0) / channelMedianViews, 4);
}

/**
 * Change in a metric over the trailing window, using the latest snapshot and
 * the most recent snapshot at or before (latest - window). Null if history is too short.
 */
export function deltaOverWindow(points: readonly SnapshotPoint[], windowHours: number): number | null {
  if (points.length < 2) return null;
  const sorted = points.toSorted((a, b) => toMs(a.capturedAt) - toMs(b.capturedAt));
  const latest = sorted.at(-1)!;
  const cutoff = toMs(latest.capturedAt) - windowHours * MS_PER_HOUR;
  const baseline = sorted.findLast((p) => toMs(p.capturedAt) <= cutoff);
  return baseline ? latest.value - baseline.value : null;
}

/** Percent growth between two values; null when the starting value is zero or unknown. */
export function growthRate(from: number | null, to: number | null): number | null {
  if (from === null || to === null || from <= 0) return null;
  return round((to - from) / from, 6);
}

export interface VideoPerformanceInput {
  viewCount: number;
  likeCount: number | null;
  commentCount: number | null;
  publishedAt: string | Date;
  /** View counts of the channel's recent comparable videos (same format), used as the outlier baseline. */
  channelRecentViewCounts: readonly number[];
  /** Historical view-count snapshots for this video. */
  viewSnapshots?: readonly SnapshotPoint[];
}

export interface VideoPerformanceMetrics {
  viewsPerDay: number;
  engagementRate: number | null;
  outlierScore: number | null;
  channelMedianViews: number | null;
  viewsDelta24h: number | null;
  viewsDelta7d: number | null;
  viewsDelta30d: number | null;
}

export function computeVideoPerformance(input: VideoPerformanceInput, now: Date = new Date()): VideoPerformanceMetrics {
  const baseline = median(input.channelRecentViewCounts);
  const snapshots = input.viewSnapshots ?? [];
  return {
    viewsPerDay: viewsPerDay(input.viewCount, input.publishedAt, now),
    engagementRate: engagementRate(input.viewCount, input.likeCount, input.commentCount),
    outlierScore: outlierScore(input.viewCount, baseline),
    channelMedianViews: baseline === null ? null : Math.round(baseline),
    viewsDelta24h: deltaOverWindow(snapshots, 24),
    viewsDelta7d: deltaOverWindow(snapshots, 24 * 7),
    viewsDelta30d: deltaOverWindow(snapshots, 24 * 30),
  };
}
