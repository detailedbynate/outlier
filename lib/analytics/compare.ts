import { deltaOverWindow, engagementRate, median } from "./metrics";

/** Pure channel comparison stats from public data (stored channel, uploads, and snapshots). */

export interface CompareVideo {
  format: string;
  view_count: number;
  like_count: number | null;
  comment_count: number | null;
  published_at: string;
}

export interface CompareInput {
  subscriberCount: number | null;
  viewCount: number | null;
  videoCount: number | null;
  createdAt: string | null;
  /** Recent uploads, any order. */
  videos: readonly CompareVideo[];
  /** Subscriber snapshots over time. */
  subscriberHistory: readonly { capturedAt: string; value: number }[];
}

export interface ChannelStats {
  subscribers: number | null;
  totalViews: number | null;
  videos: number | null;
  channelAgeDays: number | null;
  uploadsPerWeek: number;
  shortsShare: number | null;
  medianShortViews: number | null;
  medianLongViews: number | null;
  avgEngagement: number | null;
  viewsPerSub: number | null;
  topMultiplier: number | null;
  hitRate: number | null;
  subs7d: number | null;
  subs30d: number | null;
}

export type StatKey = keyof ChannelStats;

/** Rows shown in the comparison, in order. `higherIsBetter: null` means neutral (no winner). */
export const STAT_ROWS: { key: StatKey; label: string; kind: "count" | "percent" | "multiplier" | "days" | "rate"; higherIsBetter: boolean | null; hint: string }[] = [
  { key: "subscribers", label: "Subscribers", kind: "count", higherIsBetter: true, hint: "Public count (YouTube rounds large channels)" },
  { key: "subs7d", label: "Subs gained · 7 days", kind: "count", higherIsBetter: true, hint: "From daily snapshots; appears after a week of tracking" },
  { key: "subs30d", label: "Subs gained · 30 days", kind: "count", higherIsBetter: true, hint: "From daily snapshots" },
  { key: "totalViews", label: "Total views", kind: "count", higherIsBetter: true, hint: "All-time channel views" },
  { key: "medianShortViews", label: "Typical Short views", kind: "count", higherIsBetter: true, hint: "Median of recent Shorts" },
  { key: "medianLongViews", label: "Typical long-form views", kind: "count", higherIsBetter: true, hint: "Median of recent long-form videos" },
  { key: "viewsPerSub", label: "Views per subscriber", kind: "multiplier", higherIsBetter: true, hint: "Typical views ÷ subscribers" },
  { key: "avgEngagement", label: "Engagement", kind: "percent", higherIsBetter: true, hint: "(Likes + comments) ÷ views, recent uploads" },
  { key: "topMultiplier", label: "Best video vs typical", kind: "multiplier", higherIsBetter: true, hint: "Top recent upload ÷ median" },
  { key: "hitRate", label: "Hit rate", kind: "percent", higherIsBetter: true, hint: "Recent uploads with 2× the median views" },
  { key: "uploadsPerWeek", label: "Uploads per week", kind: "rate", higherIsBetter: true, hint: "Last 4 weeks" },
  { key: "shortsShare", label: "Shorts share", kind: "percent", higherIsBetter: null, hint: "Share of recent uploads that are Shorts" },
  { key: "videos", label: "Videos", kind: "count", higherIsBetter: null, hint: "Public videos on the channel" },
  { key: "channelAgeDays", label: "Channel age", kind: "days", higherIsBetter: null, hint: "Days since the channel was created" },
];

const DAY = 86_400_000;

export function computeChannelStats(input: CompareInput, now: Date = new Date()): ChannelStats {
  const videos = input.videos.filter((v) => v.format === "short" || v.format === "long_form");
  const shorts = videos.filter((v) => v.format === "short").map((v) => v.view_count);
  const longs = videos.filter((v) => v.format === "long_form").map((v) => v.view_count);
  const medianShort = median(shorts);
  const medianLong = median(longs);
  const all = videos.map((v) => v.view_count);
  const medianAll = median(all);

  const engagements = videos.map((v) => engagementRate(v.view_count, v.like_count, v.comment_count)).filter((e): e is number => e !== null);
  const recent = videos.filter((v) => now.getTime() - Date.parse(v.published_at) <= 28 * DAY).length;
  const typical = medianShort !== null && (shorts.length >= longs.length || medianLong === null) ? medianShort : medianLong;

  return {
    subscribers: input.subscriberCount,
    totalViews: input.viewCount,
    videos: input.videoCount,
    channelAgeDays: input.createdAt ? Math.floor((now.getTime() - Date.parse(input.createdAt)) / DAY) : null,
    uploadsPerWeek: Math.round((recent / 4) * 10) / 10,
    shortsShare: videos.length > 0 ? shorts.length / videos.length : null,
    medianShortViews: medianShort,
    medianLongViews: medianLong,
    avgEngagement: engagements.length > 0 ? engagements.reduce((a, b) => a + b, 0) / engagements.length : null,
    viewsPerSub: typical !== null && input.subscriberCount ? Math.round((typical / input.subscriberCount) * 100) / 100 : null,
    topMultiplier: medianAll && all.length >= 3 ? Math.round((Math.max(...all) / medianAll) * 10) / 10 : null,
    hitRate: medianAll && all.length >= 3 ? all.filter((v) => v >= 2 * medianAll).length / all.length : null,
    subs7d: deltaOverWindow(input.subscriberHistory, 24 * 7),
    subs30d: deltaOverWindow(input.subscriberHistory, 24 * 30),
  };
}

/** Average of competitors' values for a stat (ignoring unknowns). */
export function competitorAverage(stats: readonly ChannelStats[], key: StatKey): number | null {
  const values = stats.map((s) => s[key]).filter((v): v is number => v !== null);
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Index of the best value in a row, or null when neutral or tied/unknown. */
export function bestIndex(values: readonly (number | null)[], higherIsBetter: boolean | null): number | null {
  if (higherIsBetter === null) return null;
  let best: number | null = null;
  values.forEach((value, i) => {
    if (value === null) return;
    if (best === null || (higherIsBetter ? value > values[best]! : value < values[best]!)) best = i;
  });
  const winner = best as number | null;
  if (winner === null || values.filter((v) => v === values[winner]).length > 1) return null;
  return winner;
}
