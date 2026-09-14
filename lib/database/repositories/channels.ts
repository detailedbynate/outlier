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

  /** Case-insensitive @handle lookup (handles are stored with the "@"). */
  async findByHandle(handle: string): Promise<ChannelRow | null> {
    const rows = unwrap(
      await this.db.from("channels").select("*").ilike("handle", escapeLike(handle)).limit(1),
      "channels.findByHandle",
    );
    return rows[0] ?? null;
  }

  async findByIds(ids: string[]): Promise<Pick<ChannelRow, "id" | "title" | "youtube_channel_id" | "thumbnail_url" | "subscriber_count">[]> {
    if (ids.length === 0) return [];
    return unwrap(
      await this.db.from("channels").select("id, title, youtube_channel_id, thumbnail_url, subscriber_count").in("id", ids),
      "channels.findByIds",
    );
  }

  /** Channels matching any of these YouTube ids or @handles (catalog only, no API calls). */
  async findByIdentifiers(ids: string[], handles: string[]): Promise<ChannelRow[]> {
    const filters = [
      ...ids.map((id) => `youtube_channel_id.eq.${id}`),
      ...handles.map((h) => `handle.ilike."${escapeLike(h).replace(/"/g, "")}"`),
    ];
    if (filters.length === 0) return [];
    return unwrap(await this.db.from("channels").select("*").or(filters.join(",")).limit(50), "channels.findByIdentifiers");
  }

  /** Snapshots for many channels since a time, oldest first. */
  async snapshotsForChannels(channelIds: string[], since: Date): Promise<Pick<ChannelSnapshotRow, "channel_id" | "captured_at" | "subscriber_count" | "view_count">[]> {
    if (channelIds.length === 0) return [];
    return unwrap(
      await this.db
        .from("channel_snapshots")
        .select("channel_id, captured_at, subscriber_count, view_count")
        .in("channel_id", channelIds)
        .gte("captured_at", since.toISOString())
        .order("captured_at")
        .limit(5000),
      "channel_snapshots.forChannels",
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

  /**
   * Channel ids matching any keyword in the channel's title/description or its
   * stored video titles. Terms are OR'd; each term is a case-insensitive substring.
   */
  async findChannelIdsByKeywords(terms: string[], limit = 300): Promise<string[]> {
    const ids = new Set<string>();
    for (const term of terms) {
      const pattern = `*${escapeLike(term)}*`;
      const [byChannel, byVideo] = await Promise.all([
        this.db.from("channels").select("id").or(`title.ilike."${pattern}",description.ilike."${pattern}"`).limit(limit),
        this.db.from("videos").select("channel_id").ilike("title", `%${escapeLike(term)}%`).limit(limit),
      ]);
      for (const row of unwrap(byChannel, "channels.keywordSearch")) ids.add(row.id);
      for (const row of unwrap(byVideo, "videos.keywordSearch")) ids.add(row.channel_id);
    }
    return [...ids].slice(0, limit);
  }

  async searchShortsChannels(filters: ShortsChannelFilters): Promise<ShortsChannelRow[]> {
    if (filters.channelIds?.length === 0 || filters.youtubeChannelIds?.length === 0) return [];
    let query = this.db.from("shorts_channels").select("*");
    if (filters.channelIds) query = query.in("channel_id", filters.channelIds);
    if (filters.youtubeChannelIds) query = query.in("youtube_channel_id", filters.youtubeChannelIds);
    if (filters.minSubscribers !== undefined) query = query.gte("subscriber_count", filters.minSubscribers);
    if (filters.maxSubscribers !== undefined) query = query.lt("subscriber_count", filters.maxSubscribers);
    if (filters.minAvgViews !== undefined) query = query.gte("avg_short_views", filters.minAvgViews);
    if (filters.minShortsShare !== undefined) query = query.gte("shorts_share", filters.minShortsShare);
    if (filters.createdAfter) query = query.gte("channel_created_at", filters.createdAfter.toISOString());
    if (filters.activeSince) query = query.gte("last_short_at", filters.activeSince.toISOString());
    if (filters.country) query = query.eq("country", filters.country);
    if (filters.tracked !== undefined) query = query.eq("tracked", filters.tracked);
    if (filters.targetMarket) {
      query = query.eq("is_target_language", true);
      if (filters.targetMarket.countries.length > 0) {
        query = query.or(`country.is.null,country.in.(${filters.targetMarket.countries.map((c) => escapeLike(c)).join(",")})`);
      }
    }
    return unwrap(
      await query.order(filters.orderBy, { ascending: false, nullsFirst: false }).limit(filters.limit),
      "shorts_channels.search",
    );
  }

  /** Page through YouTube channel ids in a stable order (keyset pagination on youtube_channel_id). */
  async youtubeIdsPage(after: string | null, limit: number): Promise<string[]> {
    let query = this.db.from("channels").select("youtube_channel_id").order("youtube_channel_id").limit(limit);
    if (after) query = query.gt("youtube_channel_id", after);
    return unwrap(await query, "channels.youtubeIdsPage").map((r) => r.youtube_channel_id);
  }

  /** Raise channels to at least `priority` and make them due now (never lowers an existing priority). */
  async raiseMonitorPriority(ids: string[], priority: number, now: Date): Promise<void> {
    if (ids.length === 0) return;
    assertOk(
      await this.db
        .from("channels")
        .update({ monitor_priority: priority, next_check_at: now.toISOString() })
        .in("id", ids)
        .lt("monitor_priority", priority),
      "channels.raiseMonitorPriority",
    );
  }

  /** Channels whose scheduled stats check is due, highest priority first. */
  async listDueForMonitoring(now: Date, limit: number): Promise<Pick<ChannelRow, "id" | "youtube_channel_id" | "monitor_priority" | "last_synced_at">[]> {
    return unwrap(
      await this.db
        .from("channels")
        .select("id, youtube_channel_id, monitor_priority, last_synced_at")
        .lte("next_check_at", now.toISOString())
        .order("monitor_priority", { ascending: false })
        .order("next_check_at")
        .limit(limit),
      "channels.listDueForMonitoring",
    );
  }

  async scheduleMonitoring(ids: string[], priority: number, nextCheckAt: Date | null): Promise<void> {
    if (ids.length === 0) return;
    assertOk(
      await this.db
        .from("channels")
        .update({ monitor_priority: priority, next_check_at: nextCheckAt?.toISOString() ?? null })
        .in("id", ids),
      "channels.scheduleMonitoring",
    );
  }

  /** Typical Short views per channel (from the Shorts channels view), for breakout detection. */
  async medianShortViews(ids: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    for (let i = 0; i < ids.length; i += 100) {
      const rows = unwrap(
        await this.db.from("shorts_channels").select("channel_id, median_short_views").in("channel_id", ids.slice(i, i + 100)),
        "channels.medianShortViews",
      );
      for (const row of rows) if (row.median_short_views) result.set(row.channel_id, Number(row.median_short_views));
    }
    return result;
  }

  async setContentLanguage(id: string, language: string | null, checkedAt: Date): Promise<void> {
    assertOk(
      await this.db.from("channels").update({ content_language: language, language_checked_at: checkedAt.toISOString() }).eq("id", id),
      "channels.setContentLanguage",
    );
  }

  /** Channels whose language hasn't been checked yet (oldest first). */
  async listLanguageUnchecked(limit: number): Promise<Pick<ChannelRow, "id">[]> {
    return unwrap(
      await this.db.from("channels").select("id").is("language_checked_at", null).order("created_at").limit(limit),
      "channels.listLanguageUnchecked",
    );
  }

  async setTrackedMany(ids: string[], tracked: boolean): Promise<void> {
    if (ids.length === 0) return;
    assertOk(await this.db.from("channels").update({ tracked }).in("id", ids), "channels.setTrackedMany");
  }
}

export interface ShortsChannelFilters {
  /** Restrict to these channel UUIDs (e.g. keyword search results). */
  channelIds?: string[];
  /** Restrict to these YouTube channel ids. */
  youtubeChannelIds?: string[];
  minSubscribers?: number;
  maxSubscribers?: number;
  minAvgViews?: number;
  /** 0-1 share of recent uploads that are Shorts. */
  minShortsShare?: number;
  createdAfter?: Date;
  activeSince?: Date;
  /** ISO 3166 alpha-2. */
  country?: string;
  tracked?: boolean;
  /** Only channels in the target language, from listed countries (or no country set). */
  targetMarket?: { countries: readonly string[] };
  orderBy:
    | "avg_short_views"
    | "subscriber_count"
    | "channel_created_at"
    | "last_short_at"
    | "shorts_last_30d"
    | "views_24h"
    | "views_48h"
    | "subs_24h"
    | "subs_48h"
    | "top_multiplier"
    | "hit_rate"
    | "avg_engagement"
    | "shorts_per_week"
    | "recent_vph"
    | "live_vph";
  limit: number;
}

/** Escape LIKE wildcards and strip PostgREST filter separators from user input. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`).replace(/[*,()"]/g, " ");
}