import { computeVideoPerformance } from "@/lib/analytics/metrics";
import { AppError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";
import { channelToRow, type ChannelRepository } from "@/lib/database/repositories/channels";
import { videoToRow, type VideoRepository } from "@/lib/database/repositories/videos";
import { CHANNEL_ID_PATTERN } from "@/lib/youtube/parse";
import type { PageOptions, YouTubeService } from "@/lib/youtube/service";
import type { ChannelRow, VideoFormat } from "@/types/database";
import type { ChannelVideoFilter, Page, YouTubeChannel, YouTubePlaylist, YouTubeVideo } from "@/types/youtube";

export interface SyncChannelResult {
  channel: ChannelRow;
  snapshotCreated: boolean;
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

  constructor(
    private readonly youtube: YouTubeService,
    private readonly channels: ChannelRepository,
    private readonly videos: VideoRepository,
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger({ module: "services.channel" });
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
    options: { maxPages?: number; pageToken?: string; filter?: ChannelVideoFilter } = {},
    now: Date = new Date(),
  ): Promise<SyncChannelVideosResult> {
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
        maxResults: 50,
        pageToken,
      });
      pagesFetched += 1;
      nextPageToken = page.nextPageToken;
      pageToken = page.nextPageToken ?? undefined;

      const rows = await this.videos.upsertMany(page.items.map((v) => videoToRow(v, channel.id, now)));
      await this.videos.insertSnapshots(
        rows.map((row) => ({
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
    this.log.info("channel videos synced", { channelId: youtubeChannelId, videosSynced, pagesFetched });
    return { channelId: youtubeChannelId, videosSynced, pagesFetched, nextPageToken };
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
