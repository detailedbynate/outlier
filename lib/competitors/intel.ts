import { discoverSubNiches, type NicheVideo } from "@/lib/niches/analysis";

/**
 * Competitive intelligence from stored channels, snapshots, and videos.
 * Pure functions, no I/O. Every number traces back to stored data; when there
 * isn't enough data a value is null and no conclusion is drawn.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface IntelChannel {
  id: string;
  youtube_channel_id: string;
  title: string;
  handle: string | null;
  thumbnail_url: string | null;
  subscriber_count: number | null;
  hidden_subscriber_count: boolean;
  view_count: number;
  video_count: number;
  last_synced_at: string | null;
}

export interface IntelVideo {
  id: string;
  youtube_video_id: string;
  channel_id: string;
  title: string;
  tags: string[];
  format: string;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  view_count: number;
  like_count: number | null;
  comment_count: number | null;
  published_at: string;
  views_per_hour: number | null;
  view_acceleration: number | null;
  outlier_score: number | null;
  engagement_rate: number | null;
}

export interface IntelSnapshot {
  channel_id: string;
  captured_at: string;
  subscriber_count: number | null;
  view_count: number;
}

/* ---------------------------------------------------------------------------
   Helpers
--------------------------------------------------------------------------- */

export const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const mean = (values: readonly number[]): number | null => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const round = (n: number, digits = 0) => Math.round(n * 10 ** digits) / 10 ** digits;
const ageHours = (iso: string, now: Date) => Math.max((now.getTime() - Date.parse(iso)) / HOUR, 1);

/** Latest snapshot at or before a time. */
function pointAtOrBefore<T extends { captured_at: string }>(points: readonly T[], time: number): T | null {
  let best: T | null = null;
  for (const p of points) {
    const t = Date.parse(p.captured_at);
    if (t <= time && (!best || t > Date.parse(best.captured_at))) best = p;
  }
  return best;
}

/** Views per hour: monitored value when present, otherwise since upload. */
export function videoVph(video: Pick<IntelVideo, "views_per_hour" | "view_count" | "published_at">, now: Date): number {
  return video.views_per_hour !== null ? Number(video.views_per_hour) : video.view_count / ageHours(video.published_at, now);
}

export function engagementOf(video: Pick<IntelVideo, "engagement_rate" | "like_count" | "comment_count" | "view_count">): number | null {
  if (video.engagement_rate !== null) return Number(video.engagement_rate);
  if (video.view_count <= 0 || (video.like_count === null && video.comment_count === null)) return null;
  return ((video.like_count ?? 0) + (video.comment_count ?? 0)) / video.view_count;
}

/**
 * Views relative to the channel's normal performance: the stored outlier score
 * when computed, otherwise views ÷ the channel's median in this sample (3+ videos).
 */
export function multiplierFor(video: IntelVideo, channelMedian: number | null): number | null {
  if (video.outlier_score !== null) return Number(video.outlier_score);
  return channelMedian && channelMedian > 0 ? video.view_count / channelMedian : null;
}

/* ---------------------------------------------------------------------------
   Growth and trend
--------------------------------------------------------------------------- */

export interface GrowthWindow {
  subs: number | null;
  subsPct: number | null;
  views: number | null;
}

export interface Growth {
  h24: GrowthWindow;
  h48: GrowthWindow;
  d7: GrowthWindow;
  /** Null until 30 days of snapshot history exist. */
  d30: GrowthWindow | null;
  trend: Trend;
}

export type TrendLabel = "accelerating" | "rising" | "stable" | "slowing" | "insufficient";

export interface Trend {
  label: TrendLabel;
  /** Average daily view gain over the last ~3 days. */
  recentDailyViews: number | null;
  /** Average daily view gain over the 4 days before that. */
  priorDailyViews: number | null;
}

/** Windows allow some slack for snapshot timing (snapshots run every few hours). */
const WINDOWS = { h24: 20, h48: 44, d7: 24 * 6.5, d30: 24 * 29 } as const;

function windowDelta(snapshots: readonly IntelSnapshot[], hours: number, now: Date): GrowthWindow {
  const latest = pointAtOrBefore(snapshots, now.getTime());
  if (!latest) return { subs: null, subsPct: null, views: null };
  const base = pointAtOrBefore(snapshots, Date.parse(latest.captured_at) - hours * HOUR);
  if (!base) return { subs: null, subsPct: null, views: null };
  const subs = latest.subscriber_count !== null && base.subscriber_count !== null ? latest.subscriber_count - base.subscriber_count : null;
  return {
    subs,
    subsPct: subs !== null && base.subscriber_count ? round(subs / base.subscriber_count, 5) : null,
    views: latest.view_count - base.view_count,
  };
}

/**
 * Trend from view velocity: compare the daily view gain of the last ~3 days
 * with the 4 days before. Needs a week of snapshots.
 */
export function trendOf(snapshots: readonly IntelSnapshot[], now: Date): Trend {
  const latest = pointAtOrBefore(snapshots, now.getTime());
  if (!latest) return { label: "insufficient", recentDailyViews: null, priorDailyViews: null };
  const t = Date.parse(latest.captured_at);
  const mid = pointAtOrBefore(snapshots, t - 3 * DAY + 4 * HOUR);
  const start = pointAtOrBefore(snapshots, t - 7 * DAY + 8 * HOUR);
  if (!mid || !start || Date.parse(mid.captured_at) <= Date.parse(start.captured_at)) {
    return { label: "insufficient", recentDailyViews: null, priorDailyViews: null };
  }
  const recentDays = (t - Date.parse(mid.captured_at)) / DAY;
  const priorDays = (Date.parse(mid.captured_at) - Date.parse(start.captured_at)) / DAY;
  const recent = (latest.view_count - mid.view_count) / recentDays;
  const prior = (mid.view_count - start.view_count) / priorDays;

  let label: TrendLabel = "stable";
  if (prior > 0 && recent > prior * 1.25) label = "accelerating";
  else if (prior > 0 && recent < prior * 0.75) label = "slowing";
  else {
    const week = windowDelta(snapshots, WINDOWS.d7, now);
    if (week.subsPct !== null && week.subsPct >= 0.01) label = "rising";
  }
  return { label, recentDailyViews: Math.round(recent), priorDailyViews: Math.round(prior) };
}

export function growthOf(snapshots: readonly IntelSnapshot[], now: Date): Growth {
  const sorted = [...snapshots].sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));
  const first = sorted[0];
  const hasMonth = first !== undefined && now.getTime() - Date.parse(first.captured_at) >= WINDOWS.d30 * HOUR;
  return {
    h24: windowDelta(sorted, WINDOWS.h24, now),
    h48: windowDelta(sorted, WINDOWS.h48, now),
    d7: windowDelta(sorted, WINDOWS.d7, now),
    d30: hasMonth ? windowDelta(sorted, WINDOWS.d30, now) : null,
    trend: trendOf(sorted, now),
  };
}

/* ---------------------------------------------------------------------------
   Channel profile
--------------------------------------------------------------------------- */

export interface ScoredVideo extends IntelVideo {
  multiplier: number | null;
  vph: number;
  engagement: number | null;
  ageHours: number;
}

export interface ChannelProfile {
  channel: IntelChannel;
  growth: Growth;
  /** Views gained in the last 7 days (snapshots). */
  recentViews: number | null;
  avgShortViews: number | null;
  avgLongViews: number | null;
  avgViews: number | null;
  medianViews: number | null;
  uploadsPerWeek: number;
  engagement: number | null;
  /** Share of recent uploads with 2×+ the channel's normal views. */
  outlierRate: number | null;
  /** Highest multiplier among uploads from the last 30 days. */
  topOutlier: number | null;
  bestRecent: ScoredVideo | null;
  shortsShare: number | null;
  videos: ScoredVideo[];
  sampleSize: number;
  lastUpdated: string | null;
}

/** Recent uploads considered for averages. */
const PROFILE_SAMPLE = 30;

export function scoreVideos(videos: readonly IntelVideo[], now: Date): ScoredVideo[] {
  const byChannel = new Map<string, IntelVideo[]>();
  for (const v of videos) byChannel.set(v.channel_id, [...(byChannel.get(v.channel_id) ?? []), v]);
  const medians = new Map([...byChannel].map(([id, list]) => [id, list.length >= 3 ? median(list.map((v) => v.view_count)) : null]));
  return videos.map((v) => ({
    ...v,
    multiplier: (() => {
      const m = multiplierFor(v, medians.get(v.channel_id) ?? null);
      return m === null ? null : round(m, 2);
    })(),
    vph: round(videoVph(v, now), 1),
    engagement: engagementOf(v),
    ageHours: ageHours(v.published_at, now),
  }));
}

export function channelProfile(channel: IntelChannel, videos: readonly IntelVideo[], snapshots: readonly IntelSnapshot[], now: Date): ChannelProfile {
  const scored = scoreVideos(
    [...videos].filter((v) => v.channel_id === channel.id).sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at)),
    now,
  );
  const sample = scored.slice(0, PROFILE_SAMPLE);
  const shorts = sample.filter((v) => v.format === "short");
  const longs = sample.filter((v) => v.format === "long_form");
  const growth = growthOf(snapshots.filter((s) => s.channel_id === channel.id), now);
  const recent30 = scored.filter((v) => v.ageHours <= 30 * 24);
  const withMultiplier = sample.filter((v) => v.multiplier !== null);
  const engagements = sample.map((v) => v.engagement).filter((e): e is number => e !== null);
  const latestSnapshot = snapshots.filter((s) => s.channel_id === channel.id).map((s) => s.captured_at).sort().at(-1) ?? null;
  const bestRecent = [...recent30].filter((v) => v.multiplier !== null).sort((a, b) => b.multiplier! - a.multiplier!)[0] ?? null;

  return {
    channel,
    growth,
    recentViews: growth.d7.views,
    avgShortViews: shorts.length ? Math.round(mean(shorts.map((v) => v.view_count))!) : null,
    avgLongViews: longs.length ? Math.round(mean(longs.map((v) => v.view_count))!) : null,
    avgViews: sample.length ? Math.round(mean(sample.map((v) => v.view_count))!) : null,
    medianViews: sample.length ? Math.round(median(sample.map((v) => v.view_count))!) : null,
    uploadsPerWeek: round(scored.filter((v) => v.ageHours <= 28 * 24).length / 4, 1),
    engagement: engagements.length ? round(mean(engagements)!, 5) : null,
    outlierRate: withMultiplier.length >= 3 ? round(withMultiplier.filter((v) => v.multiplier! >= 2).length / withMultiplier.length, 3) : null,
    topOutlier: bestRecent?.multiplier ?? null,
    bestRecent,
    shortsShare: sample.length ? round(shorts.length / sample.length, 3) : null,
    videos: scored,
    sampleSize: sample.length,
    lastUpdated: [channel.last_synced_at, latestSnapshot].filter((x): x is string => Boolean(x)).sort().at(-1) ?? null,
  };
}

export type SortKey = "growth" | "recent_views" | "avg_views" | "outlier" | "frequency" | "subscribers";

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "growth", label: "Fastest growth" },
  { key: "recent_views", label: "Recent views" },
  { key: "avg_views", label: "Average views" },
  { key: "outlier", label: "Outlier score" },
  { key: "frequency", label: "Upload frequency" },
  { key: "subscribers", label: "Subscribers" },
];

const TREND_RANK: Record<TrendLabel, number> = { accelerating: 4, rising: 3, stable: 2, slowing: 1, insufficient: 0 };

export function sortProfiles(profiles: readonly ChannelProfile[], key: SortKey): ChannelProfile[] {
  const value = (p: ChannelProfile): number => {
    switch (key) {
      case "growth":
        // Momentum first (accelerating beats big), then relative subscriber growth.
        return TREND_RANK[p.growth.trend.label] * 10 + (p.growth.d7.subsPct ?? -1) * 100;
      case "recent_views":
        return p.recentViews ?? -1;
      case "avg_views":
        return p.avgViews ?? -1;
      case "outlier":
        return p.topOutlier ?? -1;
      case "frequency":
        return p.uploadsPerWeek;
      case "subscribers":
        return p.channel.subscriber_count ?? -1;
    }
  };
  return [...profiles].sort((a, b) => value(b) - value(a));
}

/* ---------------------------------------------------------------------------
   You vs competitors
--------------------------------------------------------------------------- */

export interface ComparisonRow {
  key: string;
  label: string;
  kind: "count" | "percent" | "rate" | "multiplier";
  you: number | null;
  competitorAvg: number | null;
  /** (you - avg) / avg, null when either side is missing. */
  diff: number | null;
  perCompetitor: { channelId: string; value: number | null; diff: number | null }[];
}

const COMPARISON_METRICS: { key: string; label: string; kind: ComparisonRow["kind"]; get: (p: ChannelProfile) => number | null; noun: string; fromSnapshots?: boolean }[] = [
  { key: "subs_growth", label: "Subscriber growth · 7d", kind: "percent", get: (p) => p.growth.d7.subsPct, noun: "subscriber growth this week", fromSnapshots: true },
  { key: "views_growth", label: "Views gained · 7d", kind: "count", get: (p) => p.growth.d7.views, noun: "views this week", fromSnapshots: true },
  { key: "avg_views", label: "Average views", kind: "count", get: (p) => p.avgViews, noun: "average views per upload" },
  { key: "median_views", label: "Median views", kind: "count", get: (p) => p.medianViews, noun: "median views per upload" },
  { key: "frequency", label: "Uploads per week", kind: "rate", get: (p) => p.uploadsPerWeek, noun: "uploads per week" },
  { key: "engagement", label: "Engagement", kind: "percent", get: (p) => p.engagement, noun: "engagement" },
  { key: "outlier_rate", label: "Outlier rate (2×+)", kind: "percent", get: (p) => p.outlierRate, noun: "outlier rate (uploads at 2×+ their channel's normal views)" },
  { key: "shorts", label: "Average Shorts views", kind: "count", get: (p) => p.avgShortViews, noun: "average views per Short" },
  { key: "long", label: "Average long-form views", kind: "count", get: (p) => p.avgLongViews, noun: "average views per long-form video" },
];

const diffOf = (you: number | null, them: number | null): number | null =>
  you === null || them === null || them === 0 ? null : round((you - them) / Math.abs(them), 3);

export function compareToCompetitors(you: ChannelProfile, competitors: readonly ChannelProfile[]): { rows: ComparisonRow[]; insights: string[] } {
  // Video-based averages only count channels with enough stored uploads to be representative.
  const usable = (m: (typeof COMPARISON_METRICS)[number], p: ChannelProfile) => (m.fromSnapshots || p.sampleSize >= 3 ? m.get(p) : null);
  const rows = COMPARISON_METRICS.map((m) => {
    const theirs = competitors.map((c) => usable(m, c)).filter((v): v is number => v !== null);
    const competitorAvg = theirs.length ? mean(theirs) : null;
    const yours = m.get(you);
    return {
      key: m.key,
      label: m.label,
      kind: m.kind,
      you: yours,
      competitorAvg,
      diff: diffOf(yours, competitorAvg),
      perCompetitor: competitors.map((c) => ({ channelId: c.channel.id, value: m.get(c), diff: diffOf(yours, usable(m, c)) })),
    };
  });

  // Only state conclusions backed by enough uploads on both sides.
  const enoughVideos = you.sampleSize >= 3 && competitors.some((c) => c.sampleSize >= 3);
  const insights = rows
    .filter((r) => r.diff !== null && Math.abs(r.diff) >= 0.1 && (enoughVideos || COMPARISON_METRICS.find((m) => m.key === r.key)!.fromSnapshots))
    .filter((r) => !(r.key === "subs_growth" && Math.abs((r.you ?? 0) - (r.competitorAvg ?? 0)) < 0.001))
    .sort((a, b) => Math.abs(b.diff!) - Math.abs(a.diff!))
    .slice(0, 4)
    .map((r) => {
      const metric = COMPARISON_METRICS.find((m) => m.key === r.key)!;
      const values = `(${formatValue(r.you, r.kind)} vs ${formatValue(r.competitorAvg, r.kind)})`;
      if (r.kind === "percent") {
        // Rates compare in percentage points; "100% less" of a rate reads badly.
        const points = round(Math.abs(r.you! - r.competitorAvg!) * 100, 1);
        return `Your ${metric.noun} is ${points} points ${r.diff! > 0 ? "higher" : "lower"} than your competitors' average ${values}.`;
      }
      const pct = Math.round(Math.abs(r.diff!) * 100);
      return `You have ${pct}% ${r.diff! > 0 ? "more" : "fewer"} ${metric.noun} than your competitors' average ${values}.`;
    });
  return { rows, insights };
}

function formatValue(value: number | null, kind: ComparisonRow["kind"]): string {
  if (value === null) return "—";
  if (kind === "percent") return `${round(value * 100, 1)}%`;
  if (kind === "rate") return `${round(value, 1)}`;
  if (kind === "multiplier") return `${round(value, 1)}×`;
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/* ---------------------------------------------------------------------------
   Breakouts
--------------------------------------------------------------------------- */

/** Recent competitor videos beating their channel's normal performance, most "right now" first. */
export function competitorBreakouts(profiles: readonly ChannelProfile[], now: Date, limit = 8): (ScoredVideo & { channel: IntelChannel; score: number })[] {
  const candidates = profiles.flatMap((p) => {
    const typicalVph = p.medianViews ? p.medianViews / (7 * 24) : null;
    return p.videos
      .filter((v) => v.ageHours <= 14 * 24)
      .filter((v) => (v.multiplier ?? 0) >= 2 || (typicalVph !== null && v.vph >= typicalVph * 3))
      .map((v) => {
        const recency = 1 - Math.min(v.ageHours / (14 * 24), 1);
        const score = Math.log2(Math.max(v.multiplier ?? 1, 1)) * 2 + Math.log10(v.vph + 1) + ((v.view_acceleration ?? 0) > 0 ? 1 : 0) + recency;
        return { ...v, channel: p.channel, score: round(score, 3) };
      });
  });
  void now;
  return candidates.sort((a, b) => b.score - a.score).slice(0, limit);
}

/* ---------------------------------------------------------------------------
   What's working
--------------------------------------------------------------------------- */

export interface PatternStat {
  label: string;
  videos: number;
  avgViews: number;
  /** Median multiplier vs each channel's normal performance. */
  medianMultiplier: number | null;
  /** Median multiplier relative to all videos in the sample. */
  lift: number | null;
  channels?: number;
}

export interface WhatsWorking {
  sampleVideos: number;
  baselineMultiplier: number | null;
  topics: PatternStat[];
  formats: PatternStat[];
  lengths: PatternStat[];
  titles: PatternStat[];
  medianUploadsPerWeek: number | null;
  medianShortSeconds: number | null;
  medianLongMinutes: number | null;
  bestWeekday: PatternStat | null;
}

const MIN_PATTERN_VIDEOS = 3;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function pattern(label: string, videos: readonly ScoredVideo[], baseline: number | null, extra: Partial<PatternStat> = {}): PatternStat | null {
  if (videos.length < MIN_PATTERN_VIDEOS) return null;
  const multipliers = videos.map((v) => v.multiplier).filter((m): m is number => m !== null);
  const med = multipliers.length ? median(multipliers) : null;
  return {
    label,
    videos: videos.length,
    avgViews: Math.round(mean(videos.map((v) => v.view_count))!),
    medianMultiplier: med === null ? null : round(med, 2),
    lift: med !== null && baseline ? round(med / baseline, 2) : null,
    ...extra,
  };
}

export function whatsWorking(profiles: readonly ChannelProfile[], now: Date, days = 60): WhatsWorking {
  const videos = profiles.flatMap((p) => p.videos.filter((v) => v.ageHours <= days * 24));
  const multipliers = videos.map((v) => v.multiplier).filter((m): m is number => m !== null);
  const baseline = multipliers.length ? median(multipliers) : null;
  const byLift = (a: PatternStat, b: PatternStat) => (b.medianMultiplier ?? 0) - (a.medianMultiplier ?? 0) || b.avgViews - a.avgViews;

  const topics = discoverSubNiches(videos as unknown as NicheVideo[], "", 12)
    .map(({ term, videoIds }) => {
      const list = videos.filter((v) => videoIds.has(v.id));
      return pattern(term, list, baseline, { channels: new Set(list.map((v) => v.channel_id)).size });
    })
    .filter((p): p is PatternStat => p !== null)
    .sort(byLift)
    .slice(0, 8);

  const shorts = videos.filter((v) => v.format === "short");
  const longs = videos.filter((v) => v.format === "long_form");
  const formats = [pattern("Shorts", shorts, baseline), pattern("Long-form", longs, baseline)].filter((p): p is PatternStat => p !== null);

  const minutes = (v: ScoredVideo) => (v.duration_seconds ?? 0) / 60;
  const lengths = [
    pattern("Under 4 min", longs.filter((v) => v.duration_seconds !== null && minutes(v) < 4), baseline),
    pattern("4–10 min", longs.filter((v) => minutes(v) >= 4 && minutes(v) < 10), baseline),
    pattern("10–20 min", longs.filter((v) => minutes(v) >= 10 && minutes(v) < 20), baseline),
    pattern("20+ min", longs.filter((v) => minutes(v) >= 20), baseline),
  ]
    .filter((p): p is PatternStat => p !== null)
    .sort(byLift);

  const titleRules: [string, (t: string) => boolean][] = [
    ["Asks a question", (t) => t.includes("?")],
    ["Includes a number", (t) => /\d/.test(t)],
    ["Uses an ALL-CAPS word", (t) => /\b[A-Z]{4,}\b/.test(t)],
    ["Includes an emoji", (t) => /\p{Extended_Pictographic}/u.test(t)],
    ["Short title (under 40 chars)", (t) => t.length < 40],
    ["Long title (over 70 chars)", (t) => t.length > 70],
  ];
  const titles = titleRules
    .map(([label, test]) => pattern(label, videos.filter((v) => test(v.title)), baseline))
    .filter((p): p is PatternStat => p !== null)
    .sort(byLift);

  const weekdays = WEEKDAYS.map((day, i) => pattern(day, videos.filter((v) => new Date(v.published_at).getUTCDay() === i), baseline)).filter(
    (p): p is PatternStat => p !== null,
  );
  const shortSeconds = shorts.map((v) => v.duration_seconds).filter((d): d is number => d !== null);
  const longSeconds = longs.map((v) => v.duration_seconds).filter((d): d is number => d !== null);
  void now;

  return {
    sampleVideos: videos.length,
    baselineMultiplier: baseline === null ? null : round(baseline, 2),
    topics,
    formats,
    lengths,
    titles,
    medianUploadsPerWeek: profiles.length ? median(profiles.map((p) => p.uploadsPerWeek)) : null,
    medianShortSeconds: shortSeconds.length ? Math.round(median(shortSeconds)!) : null,
    medianLongMinutes: longSeconds.length ? round(median(longSeconds)! / 60, 1) : null,
    bestWeekday: weekdays.filter((w) => w.medianMultiplier !== null).sort(byLift)[0] ?? null,
  };
}

/* ---------------------------------------------------------------------------
   Opportunities
--------------------------------------------------------------------------- */

export interface Opportunity {
  kind: "topic_gap" | "low_competition" | "format" | "frequency";
  title: string;
  detail: string;
  /** Sort weight; higher first. */
  weight: number;
}

const compact = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

function mentions(video: Pick<IntelVideo, "title" | "tags">, term: string): boolean {
  const haystack = `${video.title} ${video.tags.join(" ")}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

export function findOpportunities(you: ChannelProfile | null, competitors: readonly ChannelProfile[], now: Date): Opportunity[] {
  const opportunities: Opportunity[] = [];
  const recent = competitors.flatMap((p) => p.videos.filter((v) => v.ageHours <= 30 * 24));
  if (recent.length < MIN_PATTERN_VIDEOS) return [];
  const yourRecent = you ? you.videos.filter((v) => v.ageHours <= 90 * 24) : [];
  const yourMedian = you?.medianViews ?? null;

  for (const { term, videoIds } of discoverSubNiches(recent as unknown as NicheVideo[], "", 10)) {
    const list = recent.filter((v) => videoIds.has(v.id));
    const channels = new Set(list.map((v) => v.channel_id)).size;
    const avgViews = mean(list.map((v) => v.view_count))!;
    const multipliers = list.map((v) => v.multiplier).filter((m): m is number => m !== null);
    const med = multipliers.length ? median(multipliers)! : null;
    const strong = (med !== null && med >= 1.2) || (yourMedian !== null && avgViews >= yourMedian);
    if (!strong) continue;
    const perf = `averaging ${compact(avgViews)} views${med !== null ? ` (${round(med, 1)}× their usual)` : ""}`;

    if (you && !yourRecent.some((v) => mentions(v, term))) {
      opportunities.push({
        kind: "topic_gap",
        title: `Topic gap: “${term}”`,
        detail: `${channels} competitor${channels === 1 ? "" : "s"} posted ${list.length} videos about “${term}” in the last 30 days, ${perf}. You haven't covered it in your last 90 days of uploads.`,
        weight: 3 + (med ?? 1) + Math.log10(avgViews + 1),
      });
    } else if (channels <= 2 && list.length >= MIN_PATTERN_VIDEOS && med !== null && med >= 2) {
      opportunities.push({
        kind: "low_competition",
        title: `Low competition: “${term}”`,
        detail: `Only ${channels} of your competitors cover “${term}”, and their ${list.length} recent videos are ${perf}.`,
        weight: 2 + med,
      });
    }
  }

  if (you && you.sampleSize >= 5 && you.shortsShare !== null) {
    const shorts = recent.filter((v) => v.format === "short");
    const longs = recent.filter((v) => v.format === "long_form");
    const theirShare = shorts.length / recent.length;
    const medOf = (list: ScoredVideo[]) => median(list.map((v) => v.multiplier).filter((m): m is number => m !== null));
    const shortsMed = medOf(shorts);
    const longMed = medOf(longs);
    if (shorts.length >= MIN_PATTERN_VIDEOS && theirShare - you.shortsShare >= 0.3 && shortsMed !== null && shortsMed >= 1) {
      opportunities.push({
        kind: "format",
        title: "Shorts opportunity",
        detail: `${Math.round(theirShare * 100)}% of competitor uploads in the last 30 days were Shorts, averaging ${compact(mean(shorts.map((v) => v.view_count))!)} views (${round(shortsMed, 1)}× their usual). Only ${Math.round(you.shortsShare * 100)}% of your recent uploads are Shorts.`,
        weight: 2.5 + shortsMed,
      });
    }
    if (longs.length >= MIN_PATTERN_VIDEOS && you.shortsShare - theirShare >= 0.3 && longMed !== null && longMed >= 1) {
      opportunities.push({
        kind: "format",
        title: "Long-form opportunity",
        detail: `${Math.round((1 - theirShare) * 100)}% of competitor uploads in the last 30 days were long-form, averaging ${compact(mean(longs.map((v) => v.view_count))!)} views (${round(longMed, 1)}× their usual). ${Math.round((1 - you.shortsShare) * 100)}% of your recent uploads are long-form.`,
        weight: 2.5 + longMed,
      });
    }
  }

  if (you) {
    const theirFrequency = median(competitors.map((p) => p.uploadsPerWeek));
    if (theirFrequency !== null && theirFrequency >= 1 && theirFrequency >= you.uploadsPerWeek * 1.5) {
      opportunities.push({
        kind: "frequency",
        title: "Posting frequency gap",
        detail: `Your competitors upload a median ${round(theirFrequency, 1)} videos per week over the last 4 weeks; you uploaded ${round(you.uploadsPerWeek, 1)} per week.`,
        weight: 1.5,
      });
    }
  }
  void now;
  return opportunities.sort((a, b) => b.weight - a.weight).slice(0, 6);
}

/* ---------------------------------------------------------------------------
   Alerts
--------------------------------------------------------------------------- */

export const ALERT_KINDS = ["uploads", "breakouts", "subscriber_growth", "view_growth"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const ALERT_LABEL: Record<AlertKind, string> = {
  uploads: "New uploads",
  breakouts: "Breakout videos (3×+)",
  subscriber_growth: "Rapid subscriber growth",
  view_growth: "Rapid view growth",
};

export interface CompetitorAlert {
  kind: AlertKind;
  channel: IntelChannel;
  title: string;
  detail: string;
  at: string;
  youtubeVideoId?: string;
}

/** Alerts from stored data (refreshed by scheduled jobs), newest first. */
export function competitorAlerts(profiles: readonly ChannelProfile[], enabled: ReadonlySet<AlertKind>, now: Date, days = 7): CompetitorAlert[] {
  const alerts: CompetitorAlert[] = [];
  for (const p of profiles) {
    const recent = p.videos.filter((v) => v.ageHours <= days * 24);
    if (enabled.has("uploads")) {
      for (const v of recent.slice(0, 5)) {
        alerts.push({ kind: "uploads", channel: p.channel, title: `${p.channel.title} uploaded`, detail: v.title, at: v.published_at, youtubeVideoId: v.youtube_video_id });
      }
    }
    if (enabled.has("breakouts")) {
      for (const v of recent.filter((x) => (x.multiplier ?? 0) >= 3)) {
        alerts.push({
          kind: "breakouts",
          channel: p.channel,
          title: `Breakout: ${round(v.multiplier!, 1)}× ${p.channel.title}'s usual views`,
          detail: `${v.title} · ${compact(v.view_count)} views`,
          at: v.published_at,
          youtubeVideoId: v.youtube_video_id,
        });
      }
    }
    const latest = p.lastUpdated ?? now.toISOString();
    const day = p.growth.h24;
    if (enabled.has("subscriber_growth") && day.subs !== null && ((day.subsPct !== null && day.subsPct >= 0.01) || day.subs >= 1_000)) {
      alerts.push({
        kind: "subscriber_growth",
        channel: p.channel,
        title: `${p.channel.title} gained ${compact(day.subs)} subscribers in 24h`,
        detail: day.subsPct !== null ? `+${round(day.subsPct * 100, 1)}% in a day` : "",
        at: latest,
      });
    }
    const { recentDailyViews, priorDailyViews } = p.growth.trend;
    if (enabled.has("view_growth") && day.views !== null && priorDailyViews && priorDailyViews > 0 && day.views >= priorDailyViews * 2) {
      alerts.push({
        kind: "view_growth",
        channel: p.channel,
        title: `${p.channel.title}'s views are surging`,
        detail: `${compact(day.views)} views in 24h, ${round(day.views / priorDailyViews, 1)}× their recent daily average${recentDailyViews ? "" : ""}.`,
        at: latest,
      });
    }
  }
  return alerts.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/* ---------------------------------------------------------------------------
   Charts
--------------------------------------------------------------------------- */

/** One point per day (latest snapshot of each day), for sparklines. */
export function dailySeries(snapshots: readonly IntelSnapshot[], field: "subscriber_count" | "view_count", days: number, now: Date): { day: string; value: number }[] {
  const since = now.getTime() - days * DAY;
  const byDay = new Map<string, IntelSnapshot>();
  for (const s of snapshots) {
    const t = Date.parse(s.captured_at);
    if (t < since || s[field] === null) continue;
    const day = s.captured_at.slice(0, 10);
    const current = byDay.get(day);
    if (!current || t > Date.parse(current.captured_at)) byDay.set(day, s);
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, s]) => ({ day, value: s[field] as number }));
}

/** Uploads per ISO week for the last `weeks` weeks (oldest first). */
export function weeklyUploads(videos: readonly Pick<IntelVideo, "published_at" | "format">[], weeks: number, now: Date): { weekStart: string; shorts: number; longForm: number }[] {
  const result = Array.from({ length: weeks }, (_, i) => {
    const start = new Date(now.getTime() - (weeks - i) * 7 * DAY);
    return { weekStart: start.toISOString().slice(0, 10), start: start.getTime(), shorts: 0, longForm: 0 };
  });
  for (const v of videos) {
    const t = Date.parse(v.published_at);
    const bucket = result.find((w) => t >= w.start && t < w.start + 7 * DAY);
    if (!bucket) continue;
    if (v.format === "short") bucket.shorts += 1;
    else if (v.format === "long_form") bucket.longForm += 1;
  }
  return result.map(({ weekStart, shorts, longForm }) => ({ weekStart, shorts, longForm }));
}
