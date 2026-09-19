import { computeVideoPerformance } from "@/lib/analytics/metrics";
import { AppError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";
import { channelToRow, type ChannelRepository } from "@/lib/database/repositories/channels";
import { videoToRow, type VideoRepository } from "@/lib/database/repositories/videos";
import { detectContentLanguage } from "@/lib/research/quality";
import { CHANNEL_ID_PATTERN } from "@/lib/youtube/parse";
import type { PageOptions, YouTubeService } from "@/lib/youtube/service";
import type { StorageBudgetService } from "./storage-budget-service";
import type { ChannelRow, VideoFormat } from "@/types/database";
import type { ChannelVideoFilter, Page, YouTubeChannel, YouTubePlaylist, YouTubeVideo } from "@/types/youtube";

export interface SyncChannelResult {
  channel: ChannelRow;
  snapshotCreated: boolean;
}

/** Uploads sampled for channels found by research tools — enough for Shorts stats, light on storage. */
export const LIGHT_SYNC_VIDEOS = 20;

/** The YouTube reads ingestion needs; the scraper swaps in an InnerTube-first version. */
export type ChannelYouTubeSource = Pick<YouTubeService, "getChannel" | "getChannels" | "getChannelVideos" | "getChannelPlaylists">;

export interface ChannelServiceOptions {
  /** When set, ingestion refuses to write once the database is over budget. */
  storage?: Pick<StorageBudgetService, "assertCapacity">;
  /** Only videos newer than this get stat snapshots. */
  snapshotVideoMaxAgeDays?: number;
  /** Target content language for detection (default "en"). */
  language?: string;
}

export interface SyncChannelVideosResult {
  channelId: string;
  videosSynced: number;
  pagesFetched: number;
  nextPageToken: string | null;
}

/**
 * Channel use cases: live lookups against YouTube, and ingestion into the
 * catalog (channel row + time-series snapshot + videos + derived performance).
 */
export class ChannelService {
  private readonly log: Logger;

  private readonly snapshotVideoMaxAgeMs: number;

  constructor(
    private readonly youtube: ChannelYouTubeSource,
    private readonly channels: ChannelRepository,
    private readonly videos: VideoRepository,
    private readonly options: ChannelServiceOptions = {},
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger({ module: "services.channel" });
    this.snapshotVideoMaxAgeMs = (options.snapshotVideoMaxAgeDays ?? 90) * 86_400_000;
  }

  // Live reads (YouTube only, nothing persisted) -------------------------------

  lookupChannel(identifier: string): Promise<YouTubeChannel> {
    return this.youtube.getChannel(identifier);
  }

  /** Channel id as-is, otherwise resolve a handle/URL (1 quota unit). */
  async resolveChannelId(identifier: string): Promise<string> {
    const trimmed = identifier.trim();
    return CHANNEL_ID_PATTERN.test(trimmed) ? trimmed : (await this.youtube.getChannel(trimmed)).id;
  }

  async listChannelVideos(
    identifier: string,
    options: PageOptions & { filter?: ChannelVideoFilter } = {},
  ): Promise<Page<YouTubeVideo>> {
    return this.youtube.getChannelVideos(await this.resolveChannelId(identifier), options);
  }

  async listChannelPlaylists(identifier: string, options: PageOptions = {}): Promise<Page<YouTubePlaylist>> {
    return this.youtube.getChannelPlaylists(await this.resolveChannelId(identifier), options);
  }

  // Ingestion ------------------------------------------------------------------

  /** Fetch a channel from YouTube, upsert it, and append a statistics snapshot. */
  async syncChannel(identifier: string, now: Date = new Date()): Promise<SyncChannelResult> {
    await this.options.storage?.assertCapacity();
    const remote = await this.youtube.getChannel(identifier);
    const [channel] = await this.channels.upsertMany([channelToRow(remote, now)]);
    if (!channel) throw new AppError("INTERNAL_ERROR", "Channel upsert returned no row", { expose: false });

    const snapshots = await this.channels.insertSnapshots([
      {
        channel_id: channel.id,
        captured_at: now.toISOString(),
        subscriber_count: remote.statistics.subscriberCount,
        view_count: remote.statistics.viewCount,
        video_count: remote.statistics.videoCount,
      },
    ]);

    this.log.info("channel synced", { channelId: remote.id, subscribers: remote.statistics.subscriberCount });
    return { channel, snapshotCreated: snapshots.length > 0 };
  }

  /**
   * Ingest a channel's recent uploads (newest first): upsert videos, snapshot
   * their stats, and recompute performance metrics against the channel baseline.
   */
  async syncChannelVideos(
    youtubeChannelId: string,
    options: {
      maxPages?: number;
      pageToken?: string;
      filter?: ChannelVideoFilter;
      /** Uploads per page (1-50). */
      maxResults?: number;
      /** Discovered channels skip video descriptions to save storage. */
      storeDescriptions?: boolean;
    } = {},
    now: Date = new Date(),
  ): Promise<SyncChannelVideosResult> {
    await this.options.storage?.assertCapacity();
    const channel =
      (await this.channels.findByYouTubeId(youtubeChannelId)) ?? (await this.syncChannel(youtubeChannelId, now)).channel;

    const maxPages = Math.min(Math.max(options.maxPages ?? 1, 1), 20);
    let pageToken = options.pageToken;
    let pagesFetched = 0;
    let videosSynced = 0;
    let nextPageToken: string | null = null;

    do {
      const page = await this.youtube.getChannelVideos(youtubeChannelId, {
        filter: options.filter ?? "all",
        maxResults: options.maxResults ?? 50,
        pageToken,
      });
      pagesFetched += 1;
      nextPageToken = page.nextPageToken;
      pageToken = page.nextPageToken ?? undefined;

      const rows = await this.videos.upsertMany(page.items.map((v) => videoToRow(v, channel.id, now, { storeDescription: options.storeDescriptions })));
      // Old videos rarely change meaningfully; snapshotting only recent ones keeps history small.
      const snapshotCutoff = now.getTime() - this.snapshotVideoMaxAgeMs;
      await this.videos.insertSnapshots(
        rows.filter((row) => Date.parse(row.published_at) >= snapshotCutoff).map((row) => ({
          video_id: row.id,
          captured_at: now.toISOString(),
          view_count: row.view_count,
          like_count: row.like_count,
          comment_count: row.comment_count,
        })),
      );
      videosSynced += rows.length;
    } while (pageToken && pagesFetched < maxPages);

    await this.refreshPerformance(channel.id, now);
    await this.detectLanguage(channel.id, now);
    this.log.info("channel videos synced", { channelId: youtubeChannelId, videosSynced, pagesFetched });
    return { channelId: youtubeChannelId, videosSynced, pagesFetched, nextPageToken };
  }

  /**
   * Full refresh: channel stats + latest uploads + metrics.
   * `light` is for channels found by research tools: fewer uploads, no descriptions.
   * `track` marks the channel for daily refreshes.
   */
  async refreshChannel(
    identifier: string,
    options: { light?: boolean; track?: boolean } = {},
    now: Date = new Date(),
  ): Promise<SyncChannelResult & { videosSynced: number }> {
    const synced = await this.syncChannel(identifier, now);
    if (options.track && !synced.channel.tracked) {
      await this.channels.setTracked(synced.channel.id, true);
      synced.channel = { ...synced.channel, tracked: true };
    }
    const light = options.light && !synced.channel.tracked;
    const { videosSynced } = await this.syncChannelVideos(
      synced.channel.youtube_channel_id,
      { maxPages: 1, maxResults: light ? LIGHT_SYNC_VIDEOS : 50, storeDescriptions: !light },
      now,
    );
    return { ...synced, videosSynced };
  }

  /**
   * Cheap stats-only refresh for many channels: 1 quota unit per 50 channels.
   * Updates subscriber/view/video counts and appends snapshots (for 24h/48h
   * growth) without re-syncing videos or touching last_synced_at.
   */
  async snapshotChannelStats(youtubeChannelIds: string[], now: Date = new Date()): Promise<{ updated: number; snapshots: number }> {
    if (youtubeChannelIds.length === 0) return { updated: 0, snapshots: 0 };
    await this.options.storage?.assertCapacity();
    const remote = await this.youtube.getChannels(youtubeChannelIds);
    const rows = remote.map((channel) => {
      const { last_synced_at: _unchanged, ...row } = channelToRow(channel, now);
      return row;
    });
    const saved = await this.channels.upsertMany(rows);
    const byYoutubeId = new Map(remote.map((c) => [c.id, c]));
    const snapshots = await this.channels.insertSnapshots(
      saved.map((row) => {
        const stats = byYoutubeId.get(row.youtube_channel_id)!.statistics;
        return {
          channel_id: row.id,
          captured_at: now.toISOString(),
          subscriber_count: stats.subscriberCount,
          view_count: stats.viewCount,
          video_count: stats.videoCount,
        };
      }),
    );
    return { updated: saved.length, snapshots: snapshots.length };
  }

  /** Detect a channel's content language from its stored uploads (no YouTube quota). */
  async detectLanguage(channelUuid: string, now: Date = new Date()): Promise<string | null> {
    const samples = await this.videos.languageSamples(channelUuid, 20);
    const language = detectContentLanguage(samples, this.options.language ?? "en");
    await this.channels.setContentLanguage(channelUuid, language, now);
    return language;
  }

  /** Recompute video_performance for a channel's recent videos, per format. */
  async refreshPerformance(channelUuid: string, now: Date = new Date()): Promise<number> {
    let updated = 0;
    const formats: VideoFormat[] = ["long_form", "short"];
    for (const format of formats) {
      // The channel's recent videos are both the baseline and the set we score.
      const recent = await this.videos.recentVideos(channelUuid, format, 30);
      if (recent.length === 0) continue;
      const baseline = recent.map((v) => v.view_count);
      const rows = await Promise.all(
        recent.map(async (video) => {
          const snapshots = await this.videos.listSnapshots(video.id, new Date(now.getTime() - 31 * 86_400_000));
          const metrics = computeVideoPerformance(
            {
              viewCount: video.view_count,
              likeCount: video.like_count,
              commentCount: video.comment_count,
              publishedAt: video.published_at,
              channelRecentViewCounts: baseline,
              viewSnapshots: snapshots.map((s) => ({ capturedAt: s.captured_at, value: s.view_count })),
            },
            now,
          );
          return {
            video_id: video.id,
            views_per_day: metrics.viewsPerDay,
            engagement_rate: metrics.engagementRate,
            outlier_score: metrics.outlierScore,
            channel_median_views: metrics.channelMedianViews,
            views_delta_24h: metrics.viewsDelta24h,
            views_delta_7d: metrics.viewsDelta7d,
            views_delta_30d: metrics.viewsDelta30d,
            computed_at: now.toISOString(),
          };
        }),
      );
      updated += (await this.videos.upsertPerformance(rows)).length;
    }
    return updated;
  }
}
