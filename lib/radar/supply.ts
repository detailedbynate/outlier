/**
 * Supply for a search phrase: what YouTube shows someone who searches it. The
 * gaps worth finding look like this:
 *
 * - the top results are old (nobody has made a new video in a while);
 * - small channels rank and pull views far beyond their size (the audience
 *   isn't loyal to anyone yet);
 * - giant channels don't own the page.
 */

import type { YouTubeChannel, YouTubeVideo } from "@/types/youtube";

const DAY = 86_400_000;
/** Under this many subscribers counts as a small channel. */
export const SMALL_CHANNEL = 50_000;
/** Over this many is a channel a newcomer can't outrank on name alone. */
const BIG_CHANNEL = 1_000_000;

export interface SupplyVideo {
  id: string;
  title: string;
  channelTitle: string;
  views: number;
  subscribers: number | null;
  publishedAt: string;
  durationSeconds: number | null;
  /** Views per subscriber; null when the count is hidden. */
  ratio: number | null;
}

export interface Supply {
  results: number;
  /** Share of results uploaded in the last 90 days. */
  recentShare: number;
  medianAgeDays: number;
  medianViews: number;
  /** Results from channels under 50K subscribers that pulled 10K+ views and at least twice their subscriber count. */
  smallWins: number;
  /** Share of results from channels over 1M subscribers. */
  bigShare: number;
  /** Share of results under three minutes. */
  shortsShare: number;
  /** Median length of the long results, in minutes. */
  medianMinutes: number | null;
  /** The results that did best for their channel's size: proof and ideas. */
  top: SupplyVideo[];
  /** 0-1: how open the space looks (old results, small winners, no giants). */
  gap: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);

export function measureSupply(videos: readonly YouTubeVideo[], channels: readonly YouTubeChannel[], now: Date = new Date()): Supply {
  const subs = new Map(channels.map((c) => [c.id, c.statistics.hiddenSubscriberCount ? null : c.statistics.subscriberCount]));
  const rows: SupplyVideo[] = videos.map((v) => {
    const s = subs.get(v.channelId) ?? null;
    return {
      id: v.id,
      title: v.title,
      channelTitle: v.channelTitle,
      views: v.statistics.viewCount,
      subscribers: s,
      publishedAt: v.publishedAt,
      durationSeconds: v.durationSeconds,
      ratio: s && s > 0 ? v.statistics.viewCount / s : null,
    };
  });
  const n = rows.length;
  const ages = rows.map((r) => (now.getTime() - Date.parse(r.publishedAt)) / DAY).filter((d) => Number.isFinite(d) && d >= 0);
  const recentShare = n ? rows.filter((r) => now.getTime() - Date.parse(r.publishedAt) <= 90 * DAY).length / n : 0;
  const smallWins = rows.filter((r) => r.subscribers !== null && r.subscribers < SMALL_CHANNEL && r.views >= 10_000 && r.views >= 2 * r.subscribers).length;
  const bigShare = n ? rows.filter((r) => (r.subscribers ?? 0) > BIG_CHANNEL).length / n : 0;
  const shortsShare = n ? rows.filter((r) => r.durationSeconds !== null && r.durationSeconds <= 180).length / n : 0;
  const longMinutes = rows.filter((r) => r.durationSeconds !== null && r.durationSeconds > 180).map((r) => r.durationSeconds! / 60);
  const medianViews = median(rows.map((r) => r.views));

  // Old results only mean a gap if people still watch them; a dead topic is old too.
  const stale = clamp01(1 - recentShare) * clamp01(Math.log10(medianViews + 1) / 5);
  const gap = n === 0 ? 0 : clamp01(0.35 * stale + 0.4 * clamp01(smallWins / 4) + 0.25 * (1 - bigShare));

  const top = [...rows]
    .filter((r) => r.views >= 1_000)
    .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0) || b.views - a.views)
    .slice(0, 6);

  return {
    results: n,
    recentShare: round(recentShare),
    medianAgeDays: Math.round(median(ages)),
    medianViews: Math.round(medianViews),
    smallWins,
    bigShare: round(bigShare),
    shortsShare: round(shortsShare),
    medianMinutes: longMinutes.length ? Math.round(median(longMinutes)) : null,
    top,
    gap: round(gap),
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
