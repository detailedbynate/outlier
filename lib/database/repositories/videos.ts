import type { DatabaseClient } from "@/lib/database/client";
import { assertOk, unwrap, unwrapMaybe } from "@/lib/database/errors";
import type { TablesInsert, VideoFeedRow, VideoFormat, VideoPerformanceRow, VideoRow, VideoSnapshotRow } from "@/types/database";
import type { YouTubeVideo } from "@/types/youtube";
import { MAX_DESCRIPTION_CHARS, truncateText } from "./channels";

export function videoToRow(video: YouTubeVideo, channelUuid: string, syncedAt: Date): TablesInsert<"videos"> {
  return {
    youtube_video_id: video.id,
    channel_id: channelUuid,
    title: video.title,
    description: truncateText(video.description, MAX_DESCRIPTION_CHARS),
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
  }): Promise<VideoFeedRow[]> {
    let query = this.db.from("video_feed").select("*");
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
