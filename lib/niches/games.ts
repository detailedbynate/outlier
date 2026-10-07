import type { NicheChannel, NicheVideo } from "./analysis";
import { categoryFor } from "./revenue";
import { gameIn } from "./rule-labeler";

/**
 * Games with room: for every game in the library's recent uploads, how much a
 * typical upload gets, how often small channels break out with it, how many
 * channels are fighting over it, and whether it's heating up or cooling off.
 * A game where a 5K channel's upload routinely pulls 50K and only a dozen
 * channels post is a better bet than one with ten times the views and a
 * thousand channels.
 */

export interface GameStat {
  game: string;
  videos: number;
  channels: number;
  /** Channels under 100K subscribers posting it. */
  smallChannels: number;
  /** Channels under six months old posting it. */
  newChannels: number;
  medianViews: number;
  /** Share of small-channel uploads with at least 3x their subscriber count in views. */
  breakoutRate: number;
  /** Views on the last 14 days' uploads against the 14 days before (0.5 = +50%); null without enough of both. */
  momentum: number | null;
  /** 0-100: views, breakouts, room and momentum together. */
  score: number;
  /** Its best small-channel upload. */
  best: { youtubeVideoId: string; title: string; channelTitle: string; views: number; subscribers: number | null; format: "short" | "long_form" } | null;
}

const DAY = 86_400_000;
const SMALL = 100_000;
const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function measureGames(
  videos: readonly NicheVideo[],
  channels: ReadonlyMap<string, NicheChannel>,
  options: { now?: Date; days?: number; minVideos?: number; minChannels?: number; limit?: number } = {},
): GameStat[] {
  const now = options.now ?? new Date();
  const since = now.getTime() - (options.days ?? 28) * DAY;
  const half = now.getTime() - ((options.days ?? 28) / 2) * DAY;

  const byGame = new Map<string, { video: NicheVideo; channel: NicheChannel }[]>();
  for (const video of videos) {
    const published = Date.parse(video.published_at);
    if (!(published >= since)) continue;
    const channel = channels.get(video.channel_id);
    if (!channel) continue;
    const text = `${video.title} ${video.tags.slice(0, 8).join(" ")}`;
    const labels = channel.niche_terms ?? [];
    // Unlabeled channels count only when the video itself names a game; labeled non-gaming channels don't count.
    if (labels.length && categoryFor(...labels) !== "Gaming") continue;
    const game = gameIn(text) ?? (labels.length ? gameIn(labels.join(" ")) : null);
    if (!game) continue;
    const list = byGame.get(game) ?? [];
    list.push({ video, channel });
    byGame.set(game, list);
  }

  const stats: GameStat[] = [];
  for (const [game, rows] of byGame) {
    const channelIds = new Set(rows.map((r) => r.channel.id));
    if (rows.length < (options.minVideos ?? 12) || channelIds.size < (options.minChannels ?? 4)) continue;
    const small = rows.filter((r) => r.channel.subscriber_count !== null && r.channel.subscriber_count < SMALL);
    const breakouts = small.filter((r) => r.video.view_count >= 3 * Math.max(r.channel.subscriber_count ?? 0, 1_000));
    const recent = rows.filter((r) => Date.parse(r.video.published_at) >= half).map((r) => r.video.view_count);
    const earlier = rows.filter((r) => Date.parse(r.video.published_at) < half).map((r) => r.video.view_count);
    // Older uploads have had longer to collect views, so a game holding level is already warming up.
    const momentum = recent.length >= 4 && earlier.length >= 4 && median(earlier) > 0 ? Math.round((median(recent) / median(earlier) - 1) * 100) / 100 : null;
    const newChannels = new Set(
      rows.filter((r) => r.channel.published_at && now.getTime() - Date.parse(r.channel.published_at) <= 180 * DAY).map((r) => r.channel.id),
    ).size;
    const medianViews = median(rows.map((r) => r.video.view_count));
    const breakoutRate = small.length ? breakouts.length / small.length : 0;

    // Views per upload on a log scale (1K..1M), breakout odds, how few channels share it, and the trend.
    const views = clamp01(Math.log10(Math.max(medianViews, 1) / 1_000) / 3);
    const odds = clamp01(breakoutRate / 0.4);
    const room = clamp01(1 - Math.log10(channelIds.size) / Math.log10(300));
    const heat = momentum === null ? 0.5 : clamp01(0.5 + momentum / 2);
    const score = Math.round(100 * (0.35 * views + 0.3 * odds + 0.2 * room + 0.15 * heat));

    const top = [...(breakouts.length ? breakouts : small.length ? small : rows)].sort((a, b) => b.video.view_count - a.video.view_count)[0];
    stats.push({
      game,
      videos: rows.length,
      channels: channelIds.size,
      smallChannels: new Set(small.map((r) => r.channel.id)).size,
      newChannels,
      medianViews,
      breakoutRate: Math.round(breakoutRate * 100) / 100,
      momentum,
      score,
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
  return stats.sort((a, b) => b.score - a.score).slice(0, options.limit ?? 20);
}
