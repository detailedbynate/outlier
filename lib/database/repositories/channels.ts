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
  /**
   * Channels waiting for niche labels, with their recent upload titles and tags.
   * Only channels with stored uploads: without them there is nothing to judge.
   */
  async listUnlabeled(limit: number): Promise<
    (Pick<ChannelRow, "id" | "title" | "description" | "keywords" | "topic_categories" | "subscriber_count"> & {
      recentTitles: string[];
      recentTags: string[];
      uploads: { title: string; tags: string[] }[];
    })[]
  > {
    const channels = unwrap(
      await this.db
        .from("channels")
        .select("id, title, description, keywords, topic_categories, subscriber_count")
        .is("niche_labeled_at", null)
        .order("created_at", { ascending: true })
        .limit(limit * 2),
      "channels.listUnlabeled",
    );
    if (channels.length === 0) return [];

    const videos = unwrap(
      await this.db
        .from("videos")
        .select("channel_id, title, tags, published_at")
        .in("channel_id", channels.map((c) => c.id))
        .order("published_at", { ascending: false })
        .limit(channels.length * 15),
      "channels.listUnlabeledVideos",
    );
    const byChannel = new Map<string, { titles: string[]; uploads: { title: string; tags: string[] }[]; tags: Map<string, number> }>();
    for (const video of videos) {
      const entry = byChannel.get(video.channel_id) ?? { titles: [], uploads: [], tags: new Map<string, number>() };
      if (entry.titles.length < 12) entry.titles.push(video.title);
      if (entry.uploads.length < 15) entry.uploads.push({ title: video.title, tags: (video.tags ?? []).slice(0, 15) });
      for (const tag of (video.tags ?? []).slice(0, 15)) {
        const key = tag.toLowerCase();
        entry.tags.set(key, (entry.tags.get(key) ?? 0) + 1);
      }
      byChannel.set(video.channel_id, entry);
    }

    return channels
      .flatMap((channel) => {
        const entry = byChannel.get(channel.id);
        if (!entry || entry.titles.length === 0) return [];
        const recentTags = [...entry.tags.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
        return [{ ...channel, recentTitles: entry.titles, recentTags, uploads: entry.uploads }];
      })
      .slice(0, limit);
  }

  async saveNicheLabel(
    id: string,
    label: {
      nicheId: string | null;
      category: string | null;
      labels: string[];
      formats: string[];
      flags: string[];
      confidence: number | null;
      model: string;
      labeledAt: Date;
    },
  ): Promise<void> {
    assertOk(
      await this.db
        .from("channels")
        .update({
          niche_id: label.nicheId,
          niche_category: label.category,
          niche_labels: label.labels,
          content_formats: label.formats,
          quality_flags: label.flags,
          niche_confidence: label.confidence,
          niche_label_model: label.model,
          niche_labeled_at: label.labeledAt.toISOString(),
        })
        .eq("id", id),
      "channels.saveNicheLabel",
    );
  }

  /** Channels labeled with a niche entity or sub-niche matching the term. */
  async findChannelIdsByNiche(term: string, limit = 300): Promise<string[]> {
    const clean = escapeLike(term).trim().toLowerCase();
    if (clean.length < 2) return [];
    const entities = unwrap(
      await this.db.from("niches").select("id").or(`name.ilike."*${clean}*",keywords.cs.{"${clean}"}`).limit(50),
      "niches.matchTerm",
    ).map((n) => n.id);
    const ids = new Set<string>();
    if (entities.length > 0) {
      const byEntity = unwrap(await this.db.from("channels").select("id").in("niche_id", entities).limit(limit), "channels.byNicheEntity");
      for (const row of byEntity) ids.add(row.id);
    }
    const byLabel = unwrap(await this.db.from("channels").select("id").overlaps("niche_labels", [clean]).limit(limit), "channels.byNicheLabel");
    for (const row of byLabel) ids.add(row.id);
    return [...ids].slice(0, limit);
  }

  /**
   * Channels whose featured channels haven't been checked yet: confidently labeled
   * and not already huge, newest first, so growth follows creators in real niches.
   */
  async listForFeaturedCheck(limit: number, maxSubscribers: number): Promise<Pick<ChannelRow, "id" | "youtube_channel_id">[]> {
    return unwrap(
      await this.db
        .from("channels")
        .select("id, youtube_channel_id")
        .is("featured_checked_at", null)
        .gte("niche_confidence", 0.6)
        .or(`subscriber_count.is.null,subscriber_count.lt.${Math.floor(maxSubscribers)}`)
        .order("created_at", { ascending: false })
        .limit(limit),
      "channels.listForFeaturedCheck",
    );
  }

  async markFeaturedChecked(ids: string[], at: Date): Promise<void> {
    if (ids.length === 0) return;
    assertOk(await this.db.from("channels").update({ featured_checked_at: at.toISOString() }).in("id", ids), "channels.markFeaturedChecked");
  }

  /** Which of these YouTube channel ids we already store, at any age. */
  async existingIds(youtubeChannelIds: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (let i = 0; i < youtubeChannelIds.length; i += 200) {
      const rows = unwrap(
        await this.db.from("channels").select("youtube_channel_id").in("youtube_channel_id", youtubeChannelIds.slice(i, i + 200)),
        "channels.existingIds",
      );
      for (const row of rows) found.add(row.youtube_channel_id);
    }
    return found;
  }

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
    // Their views come from other people's work, so they'd crowd out real creators.
    if (filters.excludeLowQuality !== false) query = query.not("quality_flags", "ov", "{reupload,compilation,spam_or_misleading}");
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
  /** Leave out channels flagged as reuploads, compilations or spam (default true). */
  excludeLowQuality?: boolean;
  orderBy:
    | "underrated_score"
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