import { median } from "@/lib/analytics/metrics";
import { isSettled, settledPeers, TITLE_TRAITS, type TitleTraitKey, type VideoInsights } from "@/lib/analytics/video-insights";
import type { YouTubeVideo } from "@/types/youtube";

/**
 * The detailed read on one analyzed video: where it lands among the channel's
 * settled recent uploads, and what has worked
 * on the channel (posting day, length, title traits). Pure: it only reorganizes
 * what the analysis already fetched, so it costs nothing extra.
 */

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
  /** How many of the channel's settled recent uploads this one out-viewed. Null while the video is too new to compare. */
  beats: { count: number; of: number } | null;
  /** Share of them it out-viewed, 0..1. */
  percentile: number | null;
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
    growth: { last24h: number | null; last7d: number | null };
  },
  now: Date = new Date(),
): VideoBreakdown {
  const { video, peers, insights, medianViews } = input;
  const views = video.statistics.viewCount;
  const multiple = (v: YouTubeVideo) => (medianViews && medianViews > 0 ? v.statistics.viewCount / medianViews : null);
  // Uploads still climbing would drag down any "what works" average.
  const settled = peers.filter((p) => isSettled(p, now));
  const compared = settledPeers(peers, now);

  const beats = !insights.early && compared.length >= 3 ? { count: compared.filter((p) => p.statistics.viewCount < views).length, of: compared.length } : null;


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
    top,
    weekdays,
    lengths,
    traits,
    momentum,
  };
}
