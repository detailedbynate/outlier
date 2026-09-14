import { z } from "zod";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { EnqueueOptions } from "@/lib/jobs/queue";
import { DEFAULT_QUALITY, rejectReason, underratedScore, type QualityConfig, type RejectReason } from "@/lib/research/quality";
import type { YouTubeService } from "@/lib/youtube/service";

/**
 * "Trending today": once a day, find one breakout Shorts channel in each of 5
 * rotating niches. Costs ~5 searches (500 quota units) + a few list calls, and a
 * light sync for up to 10 channels. Picks are stored as the job's result.
 */

export const TRENDING_JOB_TYPE = "research.daily_trending";

export const NICHE_POOL = [
  "motivation",
  "cooking",
  "gaming",
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

export const NICHES_PER_DAY = 5;
const CANDIDATES_PER_NICHE = 2;
/** A week gives enough candidates once strict quality rules are applied. */
const LOOKBACK_DAYS = 7;

const pickSchema = z.object({
  niche: z.string(),
  youtubeChannelId: z.string(),
  channelTitle: z.string(),
  videoId: z.string(),
  videoTitle: z.string(),
  videoViews: z.number(),
  subscribers: z.number().nullable(),
  /** Underrated score (see lib/research/quality): views far above channel size, boosted by engagement. */
  score: z.number(),
  /** Backups are shown only if the primary pick doesn't qualify as a Shorts channel. */
  backup: z.boolean(),
});

export const trendingPicksSchema = z.object({ date: z.string(), niches: z.array(z.string()), picks: z.array(pickSchema) });

export type TrendingPick = z.infer<typeof pickSchema>;
export type TrendingPicks = z.infer<typeof trendingPicksSchema>;

/** Deterministic daily rotation through the niche pool. */
export function nichesForDay(now: Date, count = NICHES_PER_DAY): string[] {
  const dayNumber = Math.floor(now.getTime() / 86_400_000);
  const offset = (dayNumber * count) % NICHE_POOL.length;
  return Array.from({ length: count }, (_, i) => NICHE_POOL[(offset + i) % NICHE_POOL.length]!);
}

export class TrendingService {
  private readonly log: Logger;

  constructor(
    private readonly deps: {
      youtube: YouTubeService;
      enqueue: (type: string, payload: unknown, options?: EnqueueOptions) => Promise<unknown>;
      latestOutput: (type: string) => Promise<{ output: unknown; finishedAt: string | null } | null>;
      quality?: QualityConfig;
      regionCode?: string;
    },
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger({ module: "services.trending" });
  }

  /** Compute today's picks and queue light syncs so they show up with full stats. */
  async computeDailyPicks(now: Date = new Date()): Promise<TrendingPicks> {
    const niches = nichesForDay(now);
    const quality = this.deps.quality ?? DEFAULT_QUALITY;
    const publishedAfter = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();
    const taken = new Set<string>();
    const picks: TrendingPick[] = [];

    for (const niche of niches) {
      try {
        const videos = await this.deps.youtube.searchVideos({
          q: niche,
          videoDuration: "short",
          order: "viewCount",
          publishedAfter,
          relevanceLanguage: quality.language,
          regionCode: this.deps.regionCode,
          maxResults: 50,
        });

        // Best Short per channel; then keep only pairs that pass the quality bar, ranked by underrated score.
        const bestByChannel = new Map<string, (typeof videos.items)[number]>();
        for (const video of videos.items) {
          if (video.format !== "short" || taken.has(video.channelId)) continue;
          const best = bestByChannel.get(video.channelId);
          if (!best || video.statistics.viewCount > best.statistics.viewCount) bestByChannel.set(video.channelId, video);
        }
        const channels = await this.deps.youtube.getChannels([...bestByChannel.keys()]);
        const rejected: Partial<Record<RejectReason, number>> = {};
        const ranked = channels
          .map((channel) => ({ channel, video: bestByChannel.get(channel.id)! }))
          .filter(({ channel, video }) => {
            const reason = rejectReason(video, channel, quality);
            if (reason) rejected[reason] = (rejected[reason] ?? 0) + 1;
            return reason === null;
          })
          .map(({ channel, video }) => ({
            channel,
            video,
            subscribers: channel.statistics.subscriberCount,
            score: underratedScore(video, channel),
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, CANDIDATES_PER_NICHE);
        this.log.info("trending niche filtered", { niche, candidates: channels.length, kept: ranked.length, rejected });

        ranked.forEach(({ channel, video, subscribers, score }, index) => {
          taken.add(channel.id);
          picks.push({
            niche,
            youtubeChannelId: channel.id,
            channelTitle: channel.title,
            videoId: video.id,
            videoTitle: video.title,
            videoViews: video.statistics.viewCount,
            subscribers,
            score: Math.round(score * 100) / 100,
            backup: index > 0,
          });
        });
      } catch (error) {
        // One failing niche shouldn't sink the day's picks.
        this.log.warn("trending niche failed", { niche, error });
      }
    }

    const day = now.toISOString().slice(0, 10);
    for (const pick of picks) {
      await this.deps.enqueue(
        "channel.refresh",
        { channelId: pick.youtubeChannelId, light: true },
        { idempotencyKey: `channel.refresh:${pick.youtubeChannelId}:${day}`, priority: 8 },
      );
    }

    this.log.info("daily trending picks", { niches, picks: picks.length });
    return { date: day, niches, picks };
  }

  async latestPicks(): Promise<(TrendingPicks & { updatedAt: string | null }) | null> {
    const latest = await this.deps.latestOutput(TRENDING_JOB_TYPE);
    if (!latest) return null;
    const parsed = trendingPicksSchema.safeParse(latest.output);
    return parsed.success ? { ...parsed.data, updatedAt: latest.finishedAt } : null;
  }
}
