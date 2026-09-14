import type { DatabaseClient } from "@/lib/database/client";
import { assertOk, unwrap, unwrapMaybe } from "@/lib/database/errors";
import type { TablesInsert, VideoFeedRow, VideoFormat, VideoPerformanceRow, VideoRow, VideoSnapshotRow } from "@/types/database";
import type { YouTubeVideo } from "@/types/youtube";
import { MAX_DESCRIPTION_CHARS, truncateText } from "./channels";

export function videoToRow(
  video: YouTubeVideo,
  channelUuid: string,
  syncedAt: Date,
  options: { storeDescription?: boolean } = {},
): TablesInsert<"videos"> {
  return {
    youtube_video_id: video.id,
    channel_id: channelUuid,
    title: video.title,
    description: options.storeDescription === false ? null : truncateText(video.description, MAX_DESCRIPTION_CHARS),
    published_at: video.publishedAt,
    duration_seconds: video.durationSeconds,
    format: video.format,
    category_id: video.categoryId,
    tags: video.tags,
    default_language: video.defaultLanguage,
    default_audio_language: video.defaultAudioLanguage,
    thumbnail_url: video.thumbnailUrl,
    definition: video.definition,
    has_captions: video.hasCaptions,
    made_for_kids: video.madeForKids,
    view_count: video.statistics.viewCount,
    like_count: video.statistics.likeCount,
    comment_count: video.statistics.commentCount,
    last_synced_at: syncedAt.toISOString(),
  };
}

export type VideoPreview = Pick<VideoRow, "channel_id" | "youtube_video_id" | "title" | "thumbnail_url" | "view_count" | "published_at" | "views_per_hour">;

export type MonitoredVideo = Pick<
  VideoRow,
  "id" | "youtube_video_id" | "channel_id" | "view_count" | "published_at" | "views_per_hour" | "last_checked_at" | "last_synced_at" | "monitor_priority"
>;

export interface VideoMonitoringUpdate {
  id: string;
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
  views_per_hour: number | null;
  view_acceleration: number | null;
  monitor_priority: number;
  next_check_at: string | null;
  last_checked_at: string;
}

export type FastVideo = Pick<
  VideoRow,
  "id" | "youtube_video_id" | "channel_id" | "title" | "view_count" | "published_at" | "views_per_hour" | "view_acceleration" | "format"
> & {
  /** Views per hour used for ranking. */
  vph: number;
  /** True when vph comes from monitoring checks rather than the since-upload average. */
  live: boolean;
};

/** Recently published videos never checked yet are picked up automatically. */
export const MONITOR_NEW_VIDEO_DAYS = 14;

export class VideoRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findByYouTubeId(youtubeVideoId: string): Promise<VideoRow | null> {
    return unwrapMaybe(
      await this.db.from("videos").select("*").eq("youtube_video_id", youtubeVideoId).maybeSingle(),
      "videos.findByYouTubeId",
    );
  }

  async upsertMany(rows: TablesInsert<"videos">[]): Promise<VideoRow[]> {
    if (rows.length === 0) return [];
    return unwrap(
      await this.db.from("videos").upsert(rows, { onConflict: "youtube_video_id" }).select("*"),
      "videos.upsertMany",
    );
  }

  async insertSnapshots(rows: TablesInsert<"video_snapshots">[]): Promise<VideoSnapshotRow[]> {
    if (rows.length === 0) return [];
    return unwrap(
      await this.db
        .from("video_snapshots")
        .upsert(rows, { onConflict: "video_id,captured_at", ignoreDuplicates: true })
        .select("*"),
      "video_snapshots.insert",
    );
  }

  async listSnapshots(videoId: string, since?: Date): Promise<VideoSnapshotRow[]> {
    let query = this.db.from("video_snapshots").select("*").eq("video_id", videoId).order("captured_at");
    if (since) query = query.gte("captured_at", since.toISOString());
    return unwrap(await query, "video_snapshots.list");
  }

  /** A channel's most recent videos of one format — also the outlier baseline. */
  async recentVideos(channelUuid: string, format: VideoFormat, limit = 30): Promise<VideoRow[]> {
    return unwrap(
      await this.db
        .from("videos")
        .select("*")
        .eq("channel_id", channelUuid)
        .eq("format", format)
        .order("published_at", { ascending: false })
        .limit(limit),
      "videos.recentVideos",
    );
  }

  /**
   * Videos due for a monitoring check: scheduled ones whose time has come, plus
   * recent uploads never checked. Hottest first.
   */
  async listDueForMonitoring(now: Date, limit: number): Promise<MonitoredVideo[]> {
    const recentCutoff = new Date(now.getTime() - MONITOR_NEW_VIDEO_DAYS * 86_400_000).toISOString();
    return unwrap(
      await this.db
        .from("videos")
        .select("id, youtube_video_id, channel_id, view_count, published_at, views_per_hour, last_checked_at, last_synced_at, monitor_priority")
        .or(`next_check_at.lte."${now.toISOString()}",and(last_checked_at.is.null,published_at.gt."${recentCutoff}")`)
        .order("monitor_priority", { ascending: false })
        .order("next_check_at", { ascending: true, nullsFirst: true })
        .limit(limit),
      "videos.listDueForMonitoring",
    );
  }

  async applyMonitoring(updates: VideoMonitoringUpdate[]): Promise<number> {
    if (updates.length === 0) return 0;
    return unwrap(await this.db.rpc("apply_video_monitoring", { updates: updates as never }), "videos.applyMonitoring");
  }

  /** Latest Shorts for each channel (for card previews), newest first. Batched to stay under row limits. */
  async latestShortsByChannel(channelIds: string[], perChannel: number): Promise<Map<string, VideoPreview[]>> {
    const byChannel = new Map<string, VideoPreview[]>();
    for (let i = 0; i < channelIds.length; i += 10) {
      const batch = channelIds.slice(i, i + 10);
      const rows = unwrap(
        await this.db
          .from("videos")
          .select("channel_id, youtube_video_id, title, thumbnail_url, view_count, published_at, views_per_hour")
          .in("channel_id", batch)
          .eq("format", "short")
          .order("published_at", { ascending: false })
          .limit(batch.length * 50),
        "videos.latestShortsByChannel",
      );
      for (const row of rows) {
        const list = byChannel.get(row.channel_id) ?? [];
        if (list.length < perChannel) list.push(row);
        byChannel.set(row.channel_id, list);
      }
    }
    return byChannel;
  }

  /** Titles and declared languages of a channel's latest uploads (for language detection). */
  async languageSamples(channelUuid: string, limit = 20): Promise<{ title: string; defaultAudioLanguage: string | null; defaultLanguage: string | null }[]> {
    const rows = unwrap(
      await this.db
        .from("videos")
        .select("title, default_audio_language, default_language")
        .eq("channel_id", channelUuid)
        .order("published_at", { ascending: false })
        .limit(limit),
      "videos.languageSamples",
    );
    return rows.map((r) => ({ title: r.title, defaultAudioLanguage: r.default_audio_language, defaultLanguage: r.default_language }));
  }

  /**
   * Recent uploads with the most momentum: monitored views/hour when available,
   * otherwise views/hour since upload. Optionally only titles matching any term.
   */
  async fastMoving(options: { since: Date; limit: number; format?: VideoFormat; titleTerms?: string[] }, now: Date = new Date()): Promise<FastVideo[]> {
    let query = this.db
      .from("videos")
      .select("id, youtube_video_id, channel_id, title, view_count, published_at, views_per_hour, view_acceleration, format")
      .gte("published_at", options.since.toISOString());
    if (options.format) query = query.eq("format", options.format);
    const terms = (options.titleTerms ?? []).map((t) => t.replace(/[\\%_*,()"]/g, "").trim()).filter((t) => t.length >= 2);
    if (terms.length > 0) query = query.or(terms.map((t) => `title.ilike."*${t}*"`).join(","));
    const rows = unwrap(await query.order("view_count", { ascending: false }).limit(200), "videos.fastMoving");
    return rows
      .map((row) => {
        const ageHours = Math.max((now.getTime() - Date.parse(row.published_at)) / 3_600_000, 1);
        return { ...row, vph: row.views_per_hour !== null ? Number(row.views_per_hour) : row.view_count / ageHours, live: row.views_per_hour !== null };
      })
      .sort((a, b) => b.vph - a.vph)
      .slice(0, options.limit);
  }

  async count(): Promise<number> {
    const result = await this.db.from("videos").select("id", { count: "exact", head: true });
    assertOk(result, "videos.count");
    return result.count ?? 0;
  }

  /** Discovery feed: videos with performance metrics, filtered and ranked. */
  async feed(options: {
    orderBy: "outlier_score" | "views_per_day" | "published_at" | "view_count";
    limit: number;
    publishedAfter?: Date;
    format?: VideoFormat;
    youtubeChannelId?: string;
    /** Restrict to these channel UUIDs. */
    channelIds?: string[];
  }): Promise<VideoFeedRow[]> {
    if (options.channelIds?.length === 0) return [];
    let query = this.db.from("video_feed").select("*");
    if (options.channelIds) query = query.in("channel_id", options.channelIds);
    if (options.publishedAfter) query = query.gte("published_at", options.publishedAfter.toISOString());
    if (options.format) query = query.eq("format", options.format);
    if (options.youtubeChannelId) query = query.eq("youtube_channel_id", options.youtubeChannelId);
    return unwrap(
      await query.order(options.orderBy, { ascending: false, nullsFirst: false }).limit(options.limit),
      "video_feed.list",
    );
  }

  async upsertPerformance(rows: TablesInsert<"video_performance">[]): Promise<VideoPerformanceRow[]> {
    if (rows.length === 0) return [];
    return unwrap(
      await this.db.from("video_performance").upsert(rows, { onConflict: "video_id" }).select("*"),
      "video_performance.upsert",
    );
  }
}
