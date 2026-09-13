import type { DatabaseClient } from "@/lib/database/client";
import { assertOk, unwrap, unwrapMaybe } from "@/lib/database/errors";
import type { ChannelRow, ChannelSnapshotRow, ShortsChannelRow, TablesInsert } from "@/types/database";
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

  async list(options: { limit: number; offset?: number; tracked?: boolean }): Promise<ChannelRow[]> {
    const offset = options.offset ?? 0;
    let query = this.db.from("channels").select("*");
    if (options.tracked !== undefined) query = query.eq("tracked", options.tracked);
    return unwrap(
      await query.order("subscriber_count", { ascending: false, nullsFirst: false }).range(offset, offset + options.limit - 1),
      "channels.list",
    );
  }

  async count(options: { tracked?: boolean } = {}): Promise<number> {
    let query = this.db.from("channels").select("id", { count: "exact", head: true });
    if (options.tracked !== undefined) query = query.eq("tracked", options.tracked);
    const result = await query;
    assertOk(result, "channels.count");
    return result.count ?? 0;
  }

  async setTracked(id: string, tracked: boolean): Promise<void> {
    assertOk(await this.db.from("channels").update({ tracked }).eq("id", id), "channels.setTracked");
  }

  /**
   * Channels due for a scheduled refresh, stalest first: tracked channels synced
   * before `trackedBefore`, discovered channels synced before `discoveredBefore`.
   */
  async listDueForRefresh(trackedBefore: Date, discoveredBefore: Date, limit: number): Promise<ChannelRow[]> {
    const due = (tracked: boolean, before: Date) =>
      this.db
        .from("channels")
        .select("*")
        .eq("tracked", tracked)
        .or(`last_synced_at.is.null,last_synced_at.lt.${before.toISOString()}`)
        .order("last_synced_at", { ascending: true, nullsFirst: true })
        .limit(limit);
    const [tracked, discovered] = await Promise.all([due(true, trackedBefore), due(false, discoveredBefore)]);
    // Tracked channels take priority for the per-run budget.
    return [...unwrap(tracked, "channels.dueTracked"), ...unwrap(discovered, "channels.dueDiscovered")].slice(0, limit);
  }

  /** YouTube ids from `ids` that were synced after `since` (used to skip re-ingesting fresh channels). */
  async recentlySyncedIds(youtubeChannelIds: string[], since: Date): Promise<Set<string>> {
    if (youtubeChannelIds.length === 0) return new Set();
    const rows = unwrap(
      await this.db
        .from("channels")
        .select("youtube_channel_id")
        .in("youtube_channel_id", youtubeChannelIds)
        .gte("last_synced_at", since.toISOString()),
      "channels.recentlySyncedIds",
    );
    return new Set(rows.map((r) => r.youtube_channel_id));
  }

  async searchShortsChannels(filters: ShortsChannelFilters): Promise<ShortsChannelRow[]> {
    let query = this.db.from("shorts_channels").select("*");
    if (filters.text) query = query.ilike("title", `%${escapeLike(filters.text)}%`);
    if (filters.minSubscribers !== undefined) query = query.gte("subscriber_count", filters.minSubscribers);
    if (filters.maxSubscribers !== undefined) query = query.lt("subscriber_count", filters.maxSubscribers);
    if (filters.minAvgViews !== undefined) query = query.gte("avg_short_views", filters.minAvgViews);
    if (filters.createdAfter) query = query.gte("channel_created_at", filters.createdAfter.toISOString());
    if (filters.activeSince) query = query.gte("last_short_at", filters.activeSince.toISOString());
    return unwrap(
      await query.order(filters.orderBy, { ascending: false, nullsFirst: false }).limit(filters.limit),
      "shorts_channels.search",
    );
  }
}

export interface ShortsChannelFilters {
  text?: string;
  minSubscribers?: number;
  maxSubscribers?: number;
  minAvgViews?: number;
  createdAfter?: Date;
  activeSince?: Date;
  orderBy: "avg_short_views" | "subscriber_count" | "channel_created_at" | "last_short_at" | "shorts_last_30d";
  limit: number;
}

/** Escape LIKE wildcards and PostgREST filter separators in user input. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`).replace(/[,()]/g, " ");
}