import { median } from "@/lib/analytics/metrics";
import { TITLE_TRAITS, type TitleTraitKey, type VideoInsights } from "@/lib/analytics/video-insights";
import type { YouTubeVideo } from "@/types/youtube";

/**
 * The detailed read on one analyzed video: where it lands among the channel's
 * recent uploads, each measure next to the channel's usual, and what has worked
 * on the channel (posting day, length, title traits). Pure: it only reorganizes
 * what the analysis already fetched, so it costs nothing extra.
 */

const DAY = 86_400_000;
/** Uploads younger than this are still climbing, so they'd drag down any "what works" average. */
const SETTLED_DAYS = 3;

export interface BreakdownMeasure {
  key: "views" | "pace" | "likes" | "comments";
  value: number | null;
  usual: number | null;
  /** value / usual; null when either side is missing. */
  ratio: number | null;
}

export interface StripPoint {
  id: string;
  title: string;
  views: number;
  /** 0..1 across the strip, on a log scale. */
  pos: number;
}

export interface GroupStat {
  label: string;
  /** Settled uploads in the group. */
  count: number;
  /** Their median views over the channel's typical upload. */
  multiple: number | null;
  /** This video falls in this group. */
  current: boolean;
}

export interface TraitStat {
  key: TitleTraitKey;
  has: boolean;
  /** Median multiple of settled uploads whose titles have it, and of those without. Null under 3 uploads a side. */
  withIt: number | null;
  without: number | null;
}

export interface VideoBreakdown {
  /** How many of the channel's other recent uploads this one out-viewed. */
  beats: { count: number; of: number } | null;
  /** Share of the others it out-viewed, 0..1. */
  percentile: number | null;
  measures: BreakdownMeasure[];
  /** Every recent upload on one log-scale line, this one marked. Null without enough uploads. */
  strip: { points: StripPoint[]; self: number; median: number | null; min: number; max: number } | null;
  /** The channel's best recent uploads by multiple, settled ones only. */
  top: { video: YouTubeVideo; multiple: number }[];
  /** Posting day of the week (UTC), Sunday first. */
  weekdays: { days: GroupStat[]; best: number | null } | null;
  lengths: { buckets: GroupStat[]; best: number | null } | null;
  traits: TraitStat[];
  /** Views gained recently, from Outlier's stored checks. */
  momentum: { last24h: number | null; last7d: number | null; share24h: number | null } | null;
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const SHORT_BUCKETS: { label: string; max: number }[] = [
  { label: "≤15s", max: 15 },
  { label: "16–30s", max: 30 },
  { label: "31–45s", max: 45 },
  { label: "46–60s", max: 60 },
  { label: "1m+", max: Infinity },
];
const LONG_BUCKETS: { label: string; max: number }[] = [
  { label: "<5m", max: 299 },
  { label: "5–10m", max: 599 },
  { label: "10–20m", max: 1199 },
  { label: "20–40m", max: 2399 },
  { label: "40m+", max: Infinity },
];

const ratio = (value: number | null, usual: number | null) => (value === null || usual === null || usual <= 0 ? null : value / usual);

/** Best group: the highest median multiple among groups with at least two uploads, when it clearly leads. */
function bestOf(groups: GroupStat[]): number | null {
  let best: number | null = null;
  groups.forEach((g, i) => {
    if (g.count < 2 || g.multiple === null) return;
    if (best === null || g.multiple > groups[best]!.multiple!) best = i;
  });
  return best;
}

export function videoBreakdown(
  input: {
    video: YouTubeVideo;
    peers: readonly YouTubeVideo[];
    insights: VideoInsights;
    /** The channel's typical upload, the outlier baseline. */
    medianViews: number | null;
    viewsPerDay: number;
    growth: { last24h: number | null; last7d: number | null };
  },
  now: Date = new Date(),
): VideoBreakdown {
  const { video, peers, insights, medianViews } = input;
  const views = video.statistics.viewCount;
  const multiple = (v: YouTubeVideo) => (medianViews && medianViews > 0 ? v.statistics.viewCount / medianViews : null);
  const settled = peers.filter((p) => now.getTime() - Date.parse(p.publishedAt) >= SETTLED_DAYS * DAY);

  const beats = peers.length >= 3 ? { count: peers.filter((p) => p.statistics.viewCount < views).length, of: peers.length } : null;

  const measures: BreakdownMeasure[] = [
    { key: "views", value: views, usual: medianViews },
    { key: "pace", value: input.viewsPerDay, usual: insights.channel.medianViewsPerDay },
    { key: "likes", value: insights.likeRate, usual: insights.channel.likeRate },
    { key: "comments", value: insights.commentRate, usual: insights.channel.commentRate },
  ].map((m) => ({ ...(m as Omit<BreakdownMeasure, "ratio">), ratio: ratio(m.value, m.usual) }));

  let strip: VideoBreakdown["strip"] = null;
  if (peers.length >= 5) {
    const all = [views, ...peers.map((p) => p.statistics.viewCount)].map((n) => Math.max(n, 1));
    const lo = Math.log10(Math.min(...all));
    const hi = Math.log10(Math.max(...all));
    const pos = (n: number) => (hi === lo ? 0.5 : (Math.log10(Math.max(n, 1)) - lo) / (hi - lo));
    strip = {
      points: peers.map((p) => ({ id: p.id, title: p.title, views: p.statistics.viewCount, pos: pos(p.statistics.viewCount) })),
      self: pos(views),
      median: medianViews ? pos(medianViews) : null,
      min: Math.min(...all),
      max: Math.max(...all),
    };
  }

  const top = settled
    .map((v) => ({ video: v, multiple: multiple(v) }))
    .filter((t): t is { video: YouTubeVideo; multiple: number } => t.multiple !== null)
    .sort((a, b) => b.multiple - a.multiple)
    .slice(0, 3);

  const groupStat = (label: string, members: YouTubeVideo[], current: boolean): GroupStat => ({
    label,
    count: members.length,
    multiple: members.length ? median(members.map((m) => multiple(m)).filter((n): n is number => n !== null)) : null,
    current,
  });

  let weekdays: VideoBreakdown["weekdays"] = null;
  if (settled.length >= 8 && medianViews) {
    const day = new Date(video.publishedAt).getUTCDay();
    const days = WEEKDAY_SHORT.map((label, d) => groupStat(label, settled.filter((p) => new Date(p.publishedAt).getUTCDay() === d), d === day));
    weekdays = { days, best: bestOf(days) };
  }

  let lengths: VideoBreakdown["lengths"] = null;
  const timed = settled.filter((p) => typeof p.durationSeconds === "number" && p.durationSeconds > 0);
  if (timed.length >= 6 && medianViews) {
    const table = video.format === "short" ? SHORT_BUCKETS : LONG_BUCKETS;
    const bucketOf = (s: number) => table.findIndex((b) => s <= b.max);
    const mine = video.durationSeconds ? bucketOf(video.durationSeconds) : -1;
    const buckets = table.map((b, i) => groupStat(b.label, timed.filter((p) => bucketOf(p.durationSeconds!) === i), i === mine));
    // Trim empty buckets off both ends so the chart only spans lengths the channel uses.
    const first = buckets.findIndex((b) => b.count > 0 || b.current);
    const last = buckets.findLastIndex((b) => b.count > 0 || b.current);
    const used = buckets.slice(first, last + 1);
    lengths = { buckets: used, best: bestOf(used) };
  }

  const traits: TraitStat[] = TITLE_TRAITS.map(({ key, test }) => {
    const yes = settled.filter((p) => test(p.title));
    const no = settled.filter((p) => !test(p.title));
    const med = (group: YouTubeVideo[]) => (group.length >= 3 ? median(group.map((m) => multiple(m)).filter((n): n is number => n !== null)) : null);
    return { key, has: test(video.title), withIt: med(yes), without: med(no) };
  });

  const { last24h, last7d } = input.growth;
  const momentum = last24h !== null || last7d !== null ? { last24h, last7d, share24h: last24h !== null && views > 0 ? last24h / views : null } : null;

  return {
    beats,
    percentile: beats && beats.of > 0 ? beats.count / beats.of : null,
    measures,
    strip,
    top,
    weekdays,
    lengths,
    traits,
    momentum,
  };
}
