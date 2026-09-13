import type { DatabaseClient } from "@/lib/database/client";
import { assertOk, unwrap, unwrapMaybe } from "@/lib/database/errors";
import type { ChannelRow, ChannelSnapshotRow, TablesInsert } from "@/types/database";
import type { YouTubeChannel } from "@/types/youtube";

/** Long descriptions are the biggest per-row cost; the first part carries the useful keywords. */
export const MAX_DESCRIPTION_CHARS = 1000;

export function truncateText(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

export function channelToRow(channel: YouTubeChannel, syncedAt: Date): TablesInsert<"channels"> {
  return {
    youtube_channel_id: channel.id,
    handle: channel.handle,
    title: channel.title,
    description: truncateText(channel.description, MAX_DESCRIPTION_CHARS),
    custom_url: channel.customUrl,
    country: channel.country?.toUpperCase() ?? null,
    default_language: channel.defaultLanguage,
    thumbnail_url: channel.thumbnailUrl,
    banner_url: channel.bannerUrl,
    uploads_playlist_id: channel.uploadsPlaylistId,
    published_at: channel.publishedAt,
    subscriber_count: channel.statistics.subscriberCount,
    view_count: channel.statistics.viewCount,
    video_count: channel.statistics.videoCount,
    hidden_subscriber_count: channel.statistics.hiddenSubscriberCount,
    made_for_kids: channel.madeForKids,
    topic_categories: channel.topicCategories,
    keywords: channel.keywords,
    last_synced_at: syncedAt.toISOString(),
  };
}

export class ChannelRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findByYouTubeId(youtubeChannelId: string): Promise<ChannelRow | null> {
    return unwrapMaybe(
      await this.db.from("channels").select("*").eq("youtube_channel_id", youtubeChannelId).maybeSingle(),
      "channels.findByYouTubeId",
    );
  }

  async findById(id: string): Promise<ChannelRow | null> {
    return unwrapMaybe(await this.db.from("channels").select("*").eq("id", id).maybeSingle(), "channels.findById");
  }

  /** Insert or refresh channels by YouTube id. Never overwrites niche assignment. */
  async upsertMany(rows: TablesInsert<"channels">[]): Promise<ChannelRow[]> {
    if (rows.length === 0) return [];
    return unwrap(
      await this.db.from("channels").upsert(rows, { onConflict: "youtube_channel_id" }).select("*"),
      "channels.upsertMany",
    );
  }

  async insertSnapshots(rows: TablesInsert<"channel_snapshots">[]): Promise<ChannelSnapshotRow[]> {
    if (rows.length === 0) return [];
    return unwrap(
      await this.db
        .from("channel_snapshots")
        .upsert(rows, { onConflict: "channel_id,captured_at", ignoreDuplicates: true })
        .select("*"),
      "channel_snapshots.insert",
    );
  }

  async listSnapshots(channelId: string, since?: Date): Promise<ChannelSnapshotRow[]> {
    let query = this.db.from("channel_snapshots").select("*").eq("channel_id", channelId).order("captured_at");
    if (since) query = query.gte("captured_at", since.toISOString());
    return unwrap(await query, "channel_snapshots.list");
  }

  async list(options: { limit: number; offset?: number }): Promise<ChannelRow[]> {
    const offset = options.offset ?? 0;
    return unwrap(
      await this.db
        .from("channels")
        .select("*")
        .order("subscriber_count", { ascending: false, nullsFirst: false })
        .range(offset, offset + options.limit - 1),
      "channels.list",
    );
  }

  async count(): Promise<number> {
    const result = await this.db.from("channels").select("id", { count: "exact", head: true });
    assertOk(result, "channels.count");
    return result.count ?? 0;
  }

  /** Channels whose data is oldest (never-synced first) — feed for scheduled refresh jobs. */
  async listStale(olderThan: Date, limit: number): Promise<ChannelRow[]> {
    return unwrap(
      await this.db
        .from("channels")
        .select("*")
        .or(`last_synced_at.is.null,last_synced_at.lt.${olderThan.toISOString()}`)
        .order("last_synced_at", { ascending: true, nullsFirst: true })
        .limit(limit),
      "channels.listStale",
    );
  }
}
