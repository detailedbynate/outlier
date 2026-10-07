import type { NicheChannel, NicheVideo } from "./analysis";
import { categoryFor, rpmFor } from "./revenue";
import type { NicheCategory } from "./labeling";

/**
 * Formats working right now: title templates small channels are breaking out
 * with ("Ranking the best…", "Every … explained", "… vs … speed test"),
 * measured across the whole library. A format that works in gaming and hasn't
 * reached finance yet is a ready-made first video for a finance channel.
 */

interface FormatDef {
  id: string;
  label: string;
  pattern: RegExp;
  /** How to use it, in one line. */
  example: string;
}

export const FORMATS: readonly FormatDef[] = [
  { id: "ranking", label: "Ranking the best…", pattern: /\b(ranking|i ranked|tier list)\b/i, example: "Ranking every budgeting app from worst to best" },
  { id: "versus", label: "X vs Y", pattern: /\bvs\.?\b|\bversus\b/i, example: "Roth IRA vs 401k: which one first?" },
  { id: "every-explained", label: "Every … explained", pattern: /\b(every|all)\b.{1,40}\bexplained\b/i, example: "Every credit card perk explained in 10 minutes" },
  { id: "explained", label: "… explained", pattern: /\bexplained\b/i, example: "Capital gains tax explained simply" },
  { id: "iceberg", label: "Iceberg", pattern: /\biceberg\b/i, example: "The personal finance iceberg" },
  { id: "day-n", label: "Day N of…", pattern: /\bday \d+\b|\bpart \d+\b/i, example: "Day 12 of investing $10 a day" },
  { id: "i-tried", label: "I tried…", pattern: /\bi (tried|tested|spent|bought|survived|built)\b/i, example: "I tried every AI note-taking app for a week" },
  { id: "what-happens", label: "What happens if…", pattern: /\bwhat (happens|would happen) (if|when)\b/i, example: "What happens if you miss a credit card payment" },
  { id: "how-works", label: "How … works", pattern: /\bhow .{2,40} (works|work)\b/i, example: "How a mortgage actually works" },
  { id: "history", label: "The history of…", pattern: /\b(history of|the story of|the rise and fall|the fall of)\b/i, example: "The rise and fall of WeWork" },
  { id: "mistakes", label: "Mistakes / don't do this", pattern: /\b(mistakes?|never do|don'?t do|stop doing|avoid)\b/i, example: "5 tax mistakes that cost beginners money" },
  { id: "numbered", label: "N things / tips", pattern: /^\s*(top )?\d{1,2} (things|tips|ways|reasons|signs|habits|tricks|apps|tools|facts|secrets)\b/i, example: "7 apps that make budgeting automatic" },
  { id: "speed-test", label: "Test / comparison", pattern: /\b(speed test|stress test|tested|durability|comparison|compared)\b/i, example: "Cheap vs expensive VPN, tested" },
  { id: "pov", label: "POV", pattern: /\bpov\b/i, example: "POV: you finally paid off your credit card" },
  { id: "before-after", label: "Before / after", pattern: /\b(before (and|&|vs) after|transformation|glow.?up)\b/i, example: "My portfolio before and after one year" },
  { id: "guess", label: "Guess / quiz", pattern: /\b(guess the|quiz|can you (guess|spot|name))\b/i, example: "Guess the stock from its chart" },
  { id: "under-n", label: "In N minutes / seconds", pattern: /\bin (under )?\d+ (minutes?|seconds?|mins?)\b/i, example: "Learn Excel in 15 minutes" },
  { id: "beginners", label: "For beginners / complete guide", pattern: /\b(for beginners|beginner'?s guide|complete guide|step.by.step|from scratch)\b/i, example: "Investing for beginners, step by step" },
  { id: "secrets", label: "Nobody tells you", pattern: /\b(nobody (tells|talks)|no one (tells|talks)|they don'?t want you|secret|hidden)\b/i, example: "What nobody tells you about index funds" },
  { id: "reacting", label: "Reacting / reviewing", pattern: /\b(react(s|ing)? to|review(ing)?|roast(ing)?)\b/i, example: "Reviewing my subscribers' budgets" },
];

export interface FormatStat {
  id: string;
  label: string;
  example: string;
  /** Videos in the sample using it, from small channels. */
  videos: number;
  channels: number;
  /** Median views per subscriber among them. */
  medianLift: number;
  /** Next to the sample's median lift: 2 means twice as good as a typical upload. */
  edge: number;
  /** Where it's used most. */
  topCategories: NicheCategory[];
  /** Paying categories (long-form RPM $3+) where almost nobody uses it yet. */
  openIn: NicheCategory[];
  best: { youtubeVideoId: string; title: string; channelTitle: string; views: number; subscribers: number | null; format: "short" | "long_form" } | null;
}

const PAYING: readonly NicheCategory[] = ["Finance & Business", "Science & Tech", "Education & Explainers", "Fitness & Health", "Cars & Vehicles"];

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function measureFormats(
  videos: readonly NicheVideo[],
  channels: ReadonlyMap<string, NicheChannel>,
  options: { maxSubscribers?: number; minVideos?: number; minChannels?: number; limit?: number } = {},
): FormatStat[] {
  const maxSubs = options.maxSubscribers ?? 250_000;
  const rows = videos.flatMap((video) => {
    const channel = channels.get(video.channel_id);
    if (!channel || (channel.subscriber_count !== null && channel.subscriber_count > maxSubs)) return [];
    const category = channel.niche_terms?.length ? categoryFor(...channel.niche_terms) : categoryFor(video.title);
    return [{ video, channel, category, lift: video.view_count / Math.max(channel.subscriber_count ?? 0, 1_000) }];
  });
  const baseline = median(rows.map((r) => r.lift)) || 1;

  const stats: FormatStat[] = [];
  for (const format of FORMATS) {
    const using = rows.filter((r) => format.pattern.test(r.video.title));
    const channelIds = new Set(using.map((r) => r.video.channel_id));
    if (using.length < (options.minVideos ?? 15) || channelIds.size < (options.minChannels ?? 5)) continue;
    const medianLift = median(using.map((r) => r.lift));
    const byCategory = new Map<NicheCategory, number>();
    for (const r of using) if (r.category) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);
    const topCategories = [...byCategory].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c);
    // "Open" is relative: under 5% of this format's uses, while the category is a real part of the library.
    const libraryShare = (c: NicheCategory) => rows.filter((r) => r.category === c).length / rows.length;
    const openIn = PAYING.filter((c) => (byCategory.get(c) ?? 0) / using.length < 0.05 && libraryShare(c) >= 0.01 && rpmFor(c, "long_form")[0] >= 3);
    const top = [...using].sort((a, b) => b.lift - a.lift || b.video.view_count - a.video.view_count)[0];
    stats.push({
      id: format.id,
      label: format.label,
      example: format.example,
      videos: using.length,
      channels: channelIds.size,
      medianLift: Math.round(medianLift * 100) / 100,
      edge: Math.round((medianLift / baseline) * 100) / 100,
      topCategories,
      openIn,
      best: top
        ? {
            youtubeVideoId: top.video.youtube_video_id,
            title: top.video.title,
            channelTitle: top.channel.title,
            views: top.video.view_count,
            subscribers: top.channel.subscriber_count,
            format: top.video.format === "short" ? "short" : "long_form",
          }
        : null,
    });
  }
  return stats.filter((s) => s.edge > 1).sort((a, b) => b.edge - a.edge).slice(0, options.limit ?? 10);
}
