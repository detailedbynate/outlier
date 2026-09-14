import { median } from "@/lib/analytics/metrics";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { TrendingRepository } from "@/lib/database/repositories/trending";
import type { EnqueueOptions } from "@/lib/jobs/queue";
import { DEFAULT_QUALITY, rejectReason, underratedScore, type QualityConfig, type RejectReason } from "@/lib/research/quality";
import type { YouTubeService } from "@/lib/youtube/service";
import type { TablesInsert, TrendingPickRow } from "@/types/database";
import type { YouTubeChannel, YouTubeVideo } from "@/types/youtube";

/**
 * "Trending today": once a day, one breakout Short (plus a backup) in each of 3
 * rotating gaming categories and 2 other niches, from small, English-market channels, where the Short has at
 * least `minMultiplier`x the channel's normal views. Stats refresh hourly.
 *
 * Quota per day: ~100 per niche searched + ~2 per candidate checked + ~2 per hourly refresh.
 */

export const TRENDING_JOB_TYPE = "research.daily_trending";
export const TRENDING_REFRESH_JOB_TYPE = "research.trending_refresh";

/** Gaming leads the section: 3 picks a day from different gaming categories. */
export const GAMING_POOL = [
  "minecraft",
  "roblox",
  "fortnite",
  "gta",
  "call of duty",
  "valorant",
  "pokemon",
  "horror games",
  "clash royale",
  "brawl stars",
  "gaming funny moments",
  "retro gaming",
] as const;

/** Plus 2 picks from other niches. */
export const NICHE_POOL = [
  "motivation",
  "cooking",
  "fitness",
  "facts",
  "comedy",
  "pets",
  "beauty",
  "personal finance",
  "tech",
  "sports",
  "satisfying",
  "diy",
  "travel",
  "cars",
] as const;

export const GAMING_PER_DAY = 3;
export const OTHER_PER_DAY = 2;
export const NICHES_PER_DAY = GAMING_PER_DAY + OTHER_PER_DAY;
/** Extra niches to try per group when some come back empty. */
const EXTRA_ATTEMPTS = 2;
const CANDIDATES_TO_CHECK = 5;
const PICKS_PER_NICHE = 2;
const LOOKBACK_DAYS = 7;
const BASELINE_SHORTS = 30;

function rotate(pool: readonly string[], now: Date, perDay: number, count: number): string[] {
  const offset = (Math.floor(now.getTime() / 86_400_000) * perDay) % pool.length;
  return Array.from({ length: Math.min(count, pool.length) }, (_, i) => pool[(offset + i) % pool.length]!);
}

/** Display label: gaming categories are prefixed so they group visually. */
export function nicheLabel(query: string): string {
  return (GAMING_POOL as readonly string[]).includes(query) ? `gaming · ${query}` : query;
}

export interface TrendingConfig {
  quality?: QualityConfig;
  regionCode?: string;
  /** A pick's views must be at least this multiple of its channel's median Short views. */
  minMultiplier?: number;
}

export interface TrendingPickView extends TrendingPickRow {
  /** Views per subscriber for the picked Short. */
  viewsPerSub: number | null;
  engagement: number | null;
}

type ConfirmedPick = { channel: YouTubeChannel; video: YouTubeVideo; medianViews: number; multiplier: number; score: number };

/** Today's niches: 3 gaming categories then 2 other niches, rotating daily. */
export function nichesForDay(now: Date): string[] {
  return [...rotate(GAMING_POOL, now, GAMING_PER_DAY, GAMING_PER_DAY), ...rotate(NICHE_POOL, now, OTHER_PER_DAY, OTHER_PER_DAY)];
}

/** Change between the latest stat and the one closest to `hoursAgo` before it, within a tolerance. */
export function deltaAgo(stats: readonly { captured_at: string; views: number }[], hoursAgo: number, toleranceHours: number): number | null {
  if (stats.length < 2) return null;
  const latest = stats[stats.length - 1]!;
  const target = Date.parse(latest.captured_at) - hoursAgo * 3_600_000;
  let best: { captured_at: string; views: number } | null = null;
  for (const s of stats.slice(0, -1)) {
    const distance = Math.abs(Date.parse(s.captured_at) - target);
    if (distance <= toleranceHours * 3_600_000 && (!best || distance < Math.abs(Date.parse(best.captured_at) - target))) best = s;
  }
  return best ? latest.views - best.views : null;
}

export class TrendingService {
  private readonly log: Logger;
  private readonly quality: QualityConfig;
  private readonly minMultiplier: number;

  constructor(
    private readonly deps: {
      youtube: Pick<YouTubeService, "searchVideos" | "getChannels" | "getChannelVideos" | "getVideos">;
      repository: Pick<
        TrendingRepository,
        "latest" | "replaceForDate" | "clearAll" | "deletePick" | "updatePick" | "insertStats" | "statsSince" | "pruneStats"
      >;
      enqueue: (type: string, payload: unknown, options?: EnqueueOptions) => Promise<unknown>;
    },
    private readonly config: TrendingConfig = {},
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger({ module: "services.trending" });
    this.quality = config.quality ?? DEFAULT_QUALITY;
    this.minMultiplier = config.minMultiplier ?? 2;
  }

  /** Compute and store today's picks, replacing any existing ones for today. */
  async computeDailyPicks(now: Date = new Date()): Promise<{ date: string; niches: string[]; picks: number }> {
    const day = now.toISOString().slice(0, 10);
    const takenChannels = new Set<string>();
    const rows: TablesInsert<"trending_picks">[] = [];
    const filled: string[] = [];
    const groups = [
      { queries: rotate(GAMING_POOL, now, GAMING_PER_DAY, GAMING_PER_DAY + EXTRA_ATTEMPTS), want: GAMING_PER_DAY },
      { queries: rotate(NICHE_POOL, now, OTHER_PER_DAY, OTHER_PER_DAY + EXTRA_ATTEMPTS), want: OTHER_PER_DAY },
    ];

    for (const group of groups) {
      let got = 0;
      for (const query of group.queries) {
        if (got >= group.want) break;
        try {
          const picks = await this.pickForNiche(query, now, takenChannels);
          if (picks.length === 0) continue;
          const niche = nicheLabel(query);
          filled.push(niche);
          got += 1;
          picks.forEach((pick, rank) => {
            takenChannels.add(pick.channel.id);
            rows.push(this.toRow(day, niche, rank, pick, now));
          });
        } catch (error) {
          // One failing niche shouldn't sink the day's picks.
          this.log.warn("trending niche failed", { niche: query, error });
        }
      }
    }

    const saved = await this.deps.repository.replaceForDate(day, rows);
    await this.deps.repository.insertStats(
      saved.map((row) => ({
        pick_id: row.id,
        captured_at: now.toISOString(),
        views: row.video_views,
        likes: row.video_likes,
        comments: row.video_comments,
      })),
    );

    // Bring the channels into the catalog (light sync) so they also appear in Shorts Channels.
    for (const row of saved) {
      await this.deps.enqueue(
        "channel.refresh",
        { channelId: row.youtube_channel_id, light: true },
        { idempotencyKey: `channel.refresh:${row.youtube_channel_id}:${day}`, priority: 8 },
      );
    }
    this.log.info("daily trending picks", { niches: filled, picks: saved.length });
    return { date: day, niches: filled, picks: saved.length };
  }

  private async pickForNiche(niche: string, now: Date, taken: ReadonlySet<string>): Promise<ConfirmedPick[]> {
    const videos = await this.deps.youtube.searchVideos({
      q: niche,
      videoDuration: "short",
      order: "viewCount",
      publishedAfter: new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString(),
      relevanceLanguage: this.quality.language,
      regionCode: this.config.regionCode,
      maxResults: 50,
    });

    const bestByChannel = new Map<string, YouTubeVideo>();
    for (const video of videos.items) {
      if (video.format !== "short" || taken.has(video.channelId)) continue;
      const best = bestByChannel.get(video.channelId);
      if (!best || video.statistics.viewCount > best.statistics.viewCount) bestByChannel.set(video.channelId, video);
    }
    const channels = await this.deps.youtube.getChannels([...bestByChannel.keys()]);

    const rejected: Partial<Record<RejectReason | "low_multiplier" | "no_baseline", number>> = {};
    const candidates = channels
      .map((channel) => ({ channel, video: bestByChannel.get(channel.id)! }))
      .filter(({ channel, video }) => {
        const reason = rejectReason(video, channel, this.quality);
        if (reason) rejected[reason] = (rejected[reason] ?? 0) + 1;
        return reason === null;
      })
      .sort((a, b) => underratedScore(b.video, b.channel) - underratedScore(a.video, a.channel))
      .slice(0, CANDIDATES_TO_CHECK);

    // Confirm each candidate is an outlier for its own channel by comparing with its recent Shorts.
    const confirmed: ConfirmedPick[] = [];
    for (const { channel, video } of candidates) {
      const recent = await this.deps.youtube.getChannelVideos(channel.id, { filter: "shorts", maxResults: BASELINE_SHORTS });
      const baseline = recent.items.filter((v) => v.id !== video.id).map((v) => v.statistics.viewCount);
      const medianViews = baseline.length >= 3 ? median(baseline) : null;
      if (!medianViews || medianViews <= 0) {
        rejected.no_baseline = (rejected.no_baseline ?? 0) + 1;
        continue;
      }
      const multiplier = video.statistics.viewCount / medianViews;
      if (multiplier < this.minMultiplier) {
        rejected.low_multiplier = (rejected.low_multiplier ?? 0) + 1;
        continue;
      }
      // Rank by how far it beat its own channel, scaled by how underrated it is.
      confirmed.push({ channel, video, medianViews, multiplier, score: Math.sqrt(multiplier) * underratedScore(video, channel) });
    }

    this.log.info("trending niche filtered", { niche, searched: channels.length, confirmed: confirmed.length, rejected });
    return confirmed.sort((a, b) => b.score - a.score).slice(0, PICKS_PER_NICHE);
  }

  private toRow(day: string, niche: string, rank: number, pick: ConfirmedPick, now: Date): TablesInsert<"trending_picks"> {
    return {
      pick_date: day,
      niche,
      rank,
      youtube_channel_id: pick.channel.id,
      channel_title: pick.channel.title,
      channel_thumbnail_url: pick.channel.thumbnailUrl,
      channel_country: pick.channel.country,
      subscriber_count: pick.channel.statistics.subscriberCount,
      youtube_video_id: pick.video.id,
      video_title: pick.video.title,
      video_published_at: pick.video.publishedAt || null,
      video_views: pick.video.statistics.viewCount,
      video_likes: pick.video.statistics.likeCount,
      video_comments: pick.video.statistics.commentCount,
      channel_median_views: Math.round(pick.medianViews),
      outlier_multiplier: Math.round(pick.multiplier * 100) / 100,
      underrated_score: Math.round(pick.score * 1000) / 1000,
      stats_updated_at: now.toISOString(),
    };
  }

  /**
   * Hourly: refresh views, likes, and subscribers for the current picks, record
   * history, and recompute gains and the outlier multiplier. ~2 quota units per run.
   */
  async refreshStats(now: Date = new Date()): Promise<{ refreshed: number }> {
    const picks = await this.deps.repository.latest();
    if (picks.length === 0) return { refreshed: 0 };

    const [videos, channels] = await Promise.all([
      this.deps.youtube.getVideos(picks.map((p) => p.youtube_video_id)),
      this.deps.youtube.getChannels([...new Set(picks.map((p) => p.youtube_channel_id))]),
    ]);
    const videoById = new Map(videos.map((v) => [v.id, v]));
    const channelById = new Map(channels.map((c) => [c.id, c]));

    await this.deps.repository.insertStats(
      picks.flatMap((pick) => {
        const video = videoById.get(pick.youtube_video_id);
        return video
          ? [
              {
                pick_id: pick.id,
                captured_at: now.toISOString(),
                views: video.statistics.viewCount,
                likes: video.statistics.likeCount,
                comments: video.statistics.commentCount,
              },
            ]
          : [];
      }),
    );
    const history = await this.deps.repository.statsSince(
      picks.map((p) => p.id),
      new Date(now.getTime() - 30 * 3_600_000),
    );

    let refreshed = 0;
    for (const pick of picks) {
      const video = videoById.get(pick.youtube_video_id);
      if (!video) continue; // Deleted or private: keep the last known numbers.
      const stats = history.filter((s) => s.pick_id === pick.id);
      const views = video.statistics.viewCount;
      await this.deps.repository.updatePick(pick.id, {
        video_views: views,
        video_likes: video.statistics.likeCount,
        video_comments: video.statistics.commentCount,
        subscriber_count: channelById.get(pick.youtube_channel_id)?.statistics.subscriberCount ?? pick.subscriber_count,
        outlier_multiplier: pick.channel_median_views ? Math.round((views / pick.channel_median_views) * 100) / 100 : pick.outlier_multiplier,
        views_1h: deltaAgo(stats, 1, 0.75),
        views_24h: deltaAgo(stats, 24, 6),
        stats_updated_at: now.toISOString(),
      });
      refreshed += 1;
    }
    await this.deps.repository.pruneStats(new Date(now.getTime() - 3 * 86_400_000));
    return { refreshed };
  }

  /** Current picks for display: the best remaining pick per niche (a backup fills in if a main pick was removed). */
  async currentPicks(): Promise<TrendingPickView[]> {
    const rows = await this.deps.repository.latest();
    const byNiche = new Map<string, TrendingPickRow>();
    // Niches keep their stored order; within a niche the lowest rank wins.
    for (const row of rows) {
      const current = byNiche.get(row.niche);
      if (!current || row.rank < current.rank) byNiche.set(row.niche, row);
    }
    return [...byNiche.values()].map((row) => ({
      ...row,
      viewsPerSub: row.subscriber_count ? Math.round((row.video_views / row.subscriber_count) * 10) / 10 : null,
      engagement:
        row.video_views > 0 && (row.video_likes !== null || row.video_comments !== null)
          ? ((row.video_likes ?? 0) + (row.video_comments ?? 0)) / row.video_views
          : null,
    }));
  }

  clearAll(): Promise<void> {
    return this.deps.repository.clearAll();
  }

  removePick(id: string): Promise<void> {
    return this.deps.repository.deletePick(id);
  }
}
