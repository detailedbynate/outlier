import type { YouTubeVideo } from "@/types/youtube";

/**
 * What stands out about one video, measured against the channel's own recent
 * uploads of the same format. Pure: everything comes from the video, its
 * channel's recent uploads (already fetched for the outlier score), and any
 * view history Outlier has stored.
 */

export type TitleTraitKey = "number" | "question" | "caps" | "you" | "emoji";

export interface VideoInsights {
  /** Hours since upload. */
  ageHours: number;
  /**
   * Too new to judge: its views so far can't be set against older uploads'
   * totals, so rankings and "below usual" verdicts wait until it settles.
   */
  early: boolean;
  /** Where it ranks by views among the settled recent uploads (1 = most viewed); null while early. */
  rank: { position: number; of: number } | null;
  /** Views divided by subscribers: above 1 means it reached well past the channel's own audience. */
  viewsPerSubscriber: number | null;
  likeRate: number | null;
  commentRate: number | null;
  channel: {
    /** Median views of the settled recent uploads: the typical upload. */
    medianViews: number | null;
    likeRate: number | null;
    commentRate: number | null;
    durationSeconds: number | null;
    titleWords: number | null;
    uploadsPerWeek: number | null;
  };
  title: { words: number; traits: { key: TitleTraitKey; has: boolean; channelShare: number | null }[] };
  hashtags: string[];
  posted: { weekday: number; hourUtc: number; channelTopWeekday: number | null };
  /** From stored snapshots, when Outlier has been tracking the video. */
  growth: { last24h: number | null; last7d: number | null };
  highlights: Highlight[];
}

export interface Highlight {
  tone: "good" | "bad" | "info";
  text: string;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** A Short gets most of its views in its first few days, a long video in its first week; before that its total isn't comparable. */
export function settleDays(format: YouTubeVideo["format"]): number {
  return format === "short" ? 3 : 7;
}

export function isSettled(video: Pick<YouTubeVideo, "format" | "publishedAt">, now: Date = new Date()): boolean {
  return now.getTime() - Date.parse(video.publishedAt) >= settleDays(video.format) * DAY;
}

/**
 * The uploads that have had time to collect their views, so the baseline isn't
 * dragged down by yesterday's upload. All of them when too few have settled.
 */
export function settledPeers(peers: readonly YouTubeVideo[], now: Date = new Date()): YouTubeVideo[] {
  const settled = peers.filter((p) => isSettled(p, now));
  return settled.length >= 3 ? settled : [...peers];
}

const TRAITS: { key: TitleTraitKey; test: (title: string) => boolean; label: string }[] = [
  { key: "number", test: (t) => /\d/.test(t), label: "a number" },
  { key: "question", test: (t) => t.includes("?"), label: "a question" },
  { key: "caps", test: (t) => /\b[A-Z]{4,}\b/.test(t), label: "a word in CAPS" },
  { key: "you", test: (t) => /\byou(r|'re|rself)?\b/i.test(t), label: '"you"' },
  { key: "emoji", test: (t) => /\p{Extended_Pictographic}/u.test(t), label: "an emoji" },
];

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const rate = (count: number | null, views: number) => (count === null || views <= 0 ? null : count / views);
const wordCount = (title: string) => title.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const pct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;
const times = (n: number) => `${n >= 10 ? Math.round(n) : n.toFixed(1)}×`;
const compact = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const duration = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : `${Math.round(s)}s`);
/** "an hour", "5 hours", "2 days". */
export const ageText = (hours: number) => (hours < 1.5 ? "an hour" : hours < 36 ? `${Math.round(hours)} hours` : `${Math.round(hours / 24)} days`);

/** Hashtags from the title and description, as written, first mention first. */
export function hashtagsOf(video: Pick<YouTubeVideo, "title" | "description">): string[] {
  const found = `${video.title} ${video.description ?? ""}`.match(/#[\p{L}\p{N}_]{2,40}/gu) ?? [];
  const seen = new Set<string>();
  return found.filter((tag) => !seen.has(tag.toLowerCase()) && seen.add(tag.toLowerCase())).slice(0, 12);
}

export function videoInsights(
  video: YouTubeVideo,
  subscribers: number | null,
  peers: readonly YouTubeVideo[],
  growth: { last24h: number | null; last7d: number | null },
  now: Date = new Date(),
): VideoInsights {
  const views = video.statistics.viewCount;
  const kind = video.format === "short" ? "Shorts" : "videos";
  const one = video.format === "short" ? "Short" : "video";
  const ageHours = Math.max((now.getTime() - Date.parse(video.publishedAt)) / HOUR, 0);
  const early = !isSettled(video, now);
  // Totals only compare with uploads old enough to have collected theirs.
  const settled = settledPeers(peers, now);

  const rank = !early && settled.length >= 3 ? { position: settled.filter((p) => p.statistics.viewCount > views).length + 1, of: settled.length + 1 } : null;
  const clearLead = settled.every((p) => p.statistics.viewCount < views);

  const likeRate = rate(video.statistics.likeCount, views);
  const commentRate = rate(video.statistics.commentCount, views);
  const peerRates = (pick: (v: YouTubeVideo) => number | null) => peers.map((v) => rate(pick(v), v.statistics.viewCount)).filter((r): r is number => r !== null);

  const all = [video, ...peers];
  const spanDays = peers.length >= 2 ? (Math.max(...all.map((v) => Date.parse(v.publishedAt))) - Math.min(...all.map((v) => Date.parse(v.publishedAt)))) / DAY : 0;
  const channel = {
    medianViews: median(settled.map((v) => v.statistics.viewCount)),
    likeRate: median(peerRates((v) => v.statistics.likeCount)),
    commentRate: median(peerRates((v) => v.statistics.commentCount)),
    durationSeconds: median(peers.map((v) => v.durationSeconds).filter((d): d is number => typeof d === "number" && d > 0)),
    titleWords: median(peers.map((v) => wordCount(v.title))),
    uploadsPerWeek: spanDays >= 7 ? Math.round((all.length / spanDays) * 7 * 10) / 10 : null,
  };

  const titleTraits = TRAITS.map(({ key, test }) => ({
    key,
    has: test(video.title),
    channelShare: peers.length >= 5 ? peers.filter((p) => test(p.title)).length / peers.length : null,
  }));

  const published = new Date(video.publishedAt);
  const weekdayCounts = Array.from({ length: 7 }, (_, d) => peers.filter((p) => new Date(p.publishedAt).getUTCDay() === d).length);
  const topCount = Math.max(...weekdayCounts);
  const channelTopWeekday = peers.length >= 8 && topCount >= peers.length * 0.25 ? weekdayCounts.indexOf(topCount) : null;

  const viewsPerSubscriber = subscribers && subscribers > 0 ? views / subscribers : null;

  // What stands out, most telling first. Each line is a measured difference, never a guess at why.
  const highlights: Highlight[] = [];
  if (early) {
    // A new upload's views so far against a typical upload's total: how far along it already is, never "below usual".
    const typical = channel.medianViews;
    const age = ageText(ageHours);
    if (typical && views >= typical) {
      highlights.push({ tone: "good", text: `Already past a typical ${one}'s views (${compact(typical)}) after ${age}. That's a strong start.` });
    } else if (typical) {
      highlights.push({
        tone: "info",
        text: `Posted ${age} ago, so it's still collecting views. It has ${Math.round((views / typical) * 100)}% of a typical ${one}'s ${compact(typical)} so far; ${kind} get most of their views in the first ${settleDays(video.format)} days.`,
      });
    } else {
      highlights.push({ tone: "info", text: `Posted ${age} ago, so it's still collecting views. Check back in a few days for a fair comparison.` });
    }
  }
  // An old video measured against this month's uploads: say so, and skip the reach claim.
  const oldestPeer = peers.length ? Math.min(...peers.map((p) => Date.parse(p.publishedAt))) : null;
  const outdated = oldestPeer !== null && Date.parse(video.publishedAt) < oldestPeer - 60 * DAY;
  if (outdated) {
    const month = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
    highlights.push({
      tone: "info",
      text: `This video is from ${month.format(new Date(video.publishedAt))}, and it's being compared with the channel's uploads since ${month.format(new Date(oldestPeer!))}. Read the comparisons loosely.`,
    });
  }
  if (rank && rank.of >= 5) {
    if (rank.position === 1 && clearLead) highlights.push({ tone: "good", text: `More views than any of the channel's ${rank.of - 1} other recent ${kind}.` });
    else if (rank.position > 1 && rank.position <= Math.ceil(rank.of * 0.2)) highlights.push({ tone: "good", text: `#${rank.position} by views out of the channel's ${rank.of} most recent ${kind}.` });
    else if (rank.position > rank.of * 0.8) highlights.push({ tone: "bad", text: `Near the bottom by views: #${rank.position} out of the channel's ${rank.of} most recent ${kind}.` });
  }
  if (viewsPerSubscriber !== null && viewsPerSubscriber >= 1.5 && !outdated && ageHours <= 120 * 24) {
    highlights.push({ tone: "good", text: `Views are ${times(viewsPerSubscriber)} the channel's subscriber count, so most viewers weren't subscribers. It was pushed well beyond the channel's own audience.` });
  }
  // Rates need enough views, and enough comments, to mean anything.
  if (likeRate !== null && channel.likeRate && views >= 1000) {
    const ratio = likeRate / channel.likeRate;
    if (ratio >= 1.4) highlights.push({ tone: "good", text: `Viewers liked it more than usual: ${pct(likeRate)} like rate vs ${pct(channel.likeRate)} normally.` });
    else if (ratio <= 0.65) highlights.push({ tone: "bad", text: `Fewer likes per view than usual: ${pct(likeRate)} vs ${pct(channel.likeRate)} normally.` });
  }
  if (commentRate !== null && channel.commentRate && views >= 1000 && (video.statistics.commentCount ?? 0) >= 20) {
    const ratio = commentRate / channel.commentRate;
    if (ratio >= 1.8) highlights.push({ tone: "good", text: `It got people talking: ${times(ratio)} the channel's usual comments per view.` });
  }
  if (growth.last24h !== null && growth.last24h > 0 && growth.last24h >= views * 0.05) {
    highlights.push({ tone: "good", text: `Still climbing: +${compact(growth.last24h)} views in the last day.` });
  }
  if (video.durationSeconds && channel.durationSeconds) {
    const ratio = video.durationSeconds / channel.durationSeconds;
    if (ratio <= 0.7 || ratio >= 1.4) {
      highlights.push({
        tone: "info",
        text: `${ratio < 1 ? "Shorter" : "Longer"} than the channel's usual: ${duration(video.durationSeconds)} vs ${duration(channel.durationSeconds)}.`,
      });
    }
  }

  return {
    ageHours,
    early,
    rank,
    viewsPerSubscriber,
    likeRate,
    commentRate,
    channel,
    title: { words: wordCount(video.title), traits: titleTraits },
    hashtags: hashtagsOf(video),
    posted: { weekday: published.getUTCDay(), hourUtc: published.getUTCHours(), channelTopWeekday },
    growth,
    highlights,
  };
}

export { WEEKDAYS, TRAITS as TITLE_TRAITS };
