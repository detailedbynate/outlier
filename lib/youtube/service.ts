import { z } from "zod";
import { isAppError, NotFoundError, ValidationError } from "@/lib/core/errors";
import type {
  ChannelVideoFilter,
  Page,
  YouTubeChannel,
  YouTubePlaylist,
  YouTubePlaylistItem,
  YouTubeSearchResult,
  YouTubeVideo,
  YouTubeVideoCategory,
} from "@/types/youtube";
import type { YouTubeClient } from "./client";
import {
  mapChannel,
  mapPlaylist,
  mapPlaylistItem,
  mapSearchResult,
  mapVideo,
  mapVideoCategory,
  type VideoFormatHints,
} from "./mappers";
import { CHANNEL_ID_PATTERN, channelPlaylistId, chunk, parseChannelIdentifier, parsePlaylistId, parseVideoId } from "./parse";
import {
  listResponseSchema,
  rawChannelSchema,
  rawPlaylistItemSchema,
  rawPlaylistSchema,
  rawSearchResultSchema,
  rawVideoCategorySchema,
  rawVideoSchema,
} from "./schemas";

const CHANNEL_PARTS = ["snippet", "statistics", "contentDetails", "brandingSettings", "topicDetails", "status"];
const VIDEO_PARTS = ["snippet", "statistics", "contentDetails", "status", "topicDetails", "liveStreamingDetails"];
const MAX_IDS_PER_REQUEST = 50;

const channelList = listResponseSchema(rawChannelSchema);
const videoList = listResponseSchema(rawVideoSchema);
const playlistList = listResponseSchema(rawPlaylistSchema);
const playlistItemList = listResponseSchema(rawPlaylistItemSchema);
const searchList = listResponseSchema(rawSearchResultSchema);
const categoryList = listResponseSchema(rawVideoCategorySchema);

const isoDate = z.iso.datetime({ offset: true });

export const searchParamsSchema = z.object({
  q: z.string().trim().min(1).max(500).optional(),
  type: z.enum(["video", "channel", "playlist"]).default("video"),
  order: z.enum(["relevance", "date", "rating", "title", "videoCount", "viewCount"]).default("relevance"),
  channelId: z.string().regex(CHANNEL_ID_PATTERN).optional(),
  publishedAfter: isoDate.optional(),
  publishedBefore: isoDate.optional(),
  regionCode: z.string().regex(/^[A-Za-z]{2}$/).optional(),
  relevanceLanguage: z.string().min(2).max(8).optional(),
  /** YouTube's buckets: short < 4 min, medium 4–20 min, long > 20 min. */
  videoDuration: z.enum(["any", "short", "medium", "long"]).optional(),
  videoCategoryId: z.string().regex(/^\d+$/).optional(),
  safeSearch: z.enum(["none", "moderate", "strict"]).optional(),
  maxResults: z.coerce.number().int().min(1).max(50).default(25),
  pageToken: z.string().max(200).optional(),
});

export type SearchParams = z.input<typeof searchParamsSchema>;

export interface PageOptions {
  maxResults?: number;
  pageToken?: string;
}

function pageFrom<T>(
  items: T[],
  response: { nextPageToken?: string; prevPageToken?: string; pageInfo?: { totalResults?: number } },
): Page<T> {
  return {
    items,
    nextPageToken: response.nextPageToken ?? null,
    prevPageToken: response.prevPageToken ?? null,
    totalResults: response.pageInfo?.totalResults ?? null,
  };
}

function clampMaxResults(value: number | undefined, fallback = 50): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > 50) throw new ValidationError("maxResults must be an integer from 1 to 50");
  return value;
}

/**
 * Server-side YouTube data access. All reads go through here so caching,
 * quota metering, and fallbacks can be added in one place.
 */
export class YouTubeService {
  constructor(private readonly client: YouTubeClient) {}

  // ---------------------------------------------------------------------------
  // Channels
  // ---------------------------------------------------------------------------

  /** Resolve a channel from an id, @handle, or channel URL. */
  async getChannel(identifier: string): Promise<YouTubeChannel> {
    const parsed = parseChannelIdentifier(identifier);
    const lookup: Record<string, string> =
      parsed.type === "id"
        ? { id: parsed.value }
        : parsed.type === "username"
          ? { forUsername: parsed.value }
          : // Legacy /c/ custom URLs usually match the channel's handle.
            { forHandle: parsed.type === "custom" ? `@${parsed.value}` : parsed.value };

    const response = await this.client.get("channels", { part: CHANNEL_PARTS, ...lookup }, channelList);
    const raw = response.items[0];
    if (!raw) throw new NotFoundError("YouTube channel", identifier);
    return mapChannel(raw);
  }

  /** Batch lookup by channel id. Missing/terminated channels are omitted. Order follows the input. */
  async getChannels(channelIds: readonly string[]): Promise<YouTubeChannel[]> {
    const ids = [...new Set(channelIds)];
    for (const id of ids) if (!CHANNEL_ID_PATTERN.test(id)) throw new ValidationError(`Invalid channel id: ${id}`);

    const byId = new Map<string, YouTubeChannel>();
    for (const batch of chunk(ids, MAX_IDS_PER_REQUEST)) {
      const response = await this.client.get("channels", { part: CHANNEL_PARTS, id: batch, maxResults: 50 }, channelList);
      for (const raw of response.items) byId.set(raw.id, mapChannel(raw));
    }
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  /**
   * A channel's uploads, newest first, hydrated with statistics.
   * `filter` uses YouTube's per-channel Shorts (UUSH) / long-form (UULF) playlists.
   */
  async getChannelVideos(
    channelId: string,
    options: PageOptions & { filter?: ChannelVideoFilter } = {},
  ): Promise<Page<YouTubeVideo>> {
    const filter = options.filter ?? "all";
    const kind = filter === "all" ? "uploads" : filter;
    const playlistId = channelPlaylistId(channelId, kind);

    let items: Page<YouTubePlaylistItem>;
    try {
      items = await this.getPlaylistItems(playlistId, options);
    } catch (error) {
      // Channels with no Shorts (or no long-form videos) have no such playlist.
      if (isAppError(error) && error.code === "NOT_FOUND") {
        return { items: [], nextPageToken: null, prevPageToken: null, totalResults: 0 };
      }
      throw error;
    }

    const ids = items.items.map((i) => i.videoId);
    const hints: VideoFormatHints =
      filter === "shorts"
        ? { knownShortIds: new Set(ids) }
        : filter === "long_form"
          ? { knownLongFormIds: new Set(ids) }
          : await this.uploadFormatHints(channelId, items.items);
    const videos = await this.getVideos(ids, hints);
    return { ...items, items: videos };
  }

  /**
   * Classify mixed uploads using the channel's Shorts playlist (1 extra unit):
   * listed videos are Shorts; unlisted uploads are long-form when the Shorts page
   * covers their publish date. Anything older falls back to the duration heuristic.
   */
  private async uploadFormatHints(channelId: string, uploads: YouTubePlaylistItem[]): Promise<VideoFormatHints> {
    let shorts: Page<YouTubePlaylistItem>;
    try {
      shorts = await this.getPlaylistItems(channelPlaylistId(channelId, "shorts"), { maxResults: 50 });
    } catch (error) {
      // No Shorts playlist means the channel has no Shorts; other errors just lose the hint.
      if (isAppError(error) && error.code === "NOT_FOUND") shorts = { items: [], nextPageToken: null, prevPageToken: null, totalResults: 0 };
      else return {};
    }

    const knownShortIds = new Set(shorts.items.map((i) => i.videoId));
    const complete = shorts.nextPageToken === null;
    const oldestListedShort = Math.min(...shorts.items.map((i) => Date.parse(i.videoPublishedAt ?? i.addedAt ?? "")).filter(Number.isFinite));
    const knownLongFormIds = new Set(
      uploads
        .filter((u) => !knownShortIds.has(u.videoId))
        .filter((u) => complete || Date.parse(u.videoPublishedAt ?? "") >= oldestListedShort)
        .map((u) => u.videoId),
    );
    return { knownShortIds, knownLongFormIds };
  }

  async getChannelShorts(channelId: string, options: PageOptions = {}): Promise<Page<YouTubeVideo>> {
    return this.getChannelVideos(channelId, { ...options, filter: "shorts" });
  }

  async getChannelPlaylists(channelId: string, options: PageOptions = {}): Promise<Page<YouTubePlaylist>> {
    if (!CHANNEL_ID_PATTERN.test(channelId)) throw new ValidationError(`Invalid channel id: ${channelId}`);
    const response = await this.client.get(
      "playlists",
      {
        part: ["snippet", "contentDetails", "status"],
        channelId,
        maxResults: clampMaxResults(options.maxResults, 25),
        pageToken: options.pageToken,
      },
      playlistList,
    );
    return pageFrom(response.items.map(mapPlaylist), response);
  }

  // ---------------------------------------------------------------------------
  // Videos
  // ---------------------------------------------------------------------------

  /** Look up a single video by id or URL. */
  async getVideo(idOrUrl: string): Promise<YouTubeVideo> {
    const id = parseVideoId(idOrUrl);
    const [video] = await this.getVideos([id]);
    if (!video) throw new NotFoundError("YouTube video", id);
    return video;
  }

  /** Batch lookup by video id. Private/deleted videos are omitted. Order follows the input. */
  async getVideos(videoIds: readonly string[], hints: VideoFormatHints = {}): Promise<YouTubeVideo[]> {
    const ids = [...new Set(videoIds.map(parseVideoId))];
    const byId = new Map<string, YouTubeVideo>();
    for (const batch of chunk(ids, MAX_IDS_PER_REQUEST)) {
      const response = await this.client.get("videos", { part: VIDEO_PARTS, id: batch, maxResults: 50 }, videoList);
      for (const raw of response.items) byId.set(raw.id, mapVideo(raw, hints));
    }
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  /** Most popular videos for a region (optionally within a category). */
  async getTrendingVideos(
    options: PageOptions & { regionCode?: string; videoCategoryId?: string } = {},
  ): Promise<Page<YouTubeVideo>> {
    const response = await this.client.get(
      "videos",
      {
        part: VIDEO_PARTS,
        chart: "mostPopular",
        regionCode: options.regionCode ?? "US",
        videoCategoryId: options.videoCategoryId,
        maxResults: clampMaxResults(options.maxResults, 25),
        pageToken: options.pageToken,
      },
      videoList,
    );
    return pageFrom(
      response.items.map((raw) => mapVideo(raw)),
      response,
    );
  }

  async getVideoCategories(regionCode = "US"): Promise<YouTubeVideoCategory[]> {
    const response = await this.client.get("videoCategories", { part: "snippet", regionCode }, categoryList);
    return response.items.map(mapVideoCategory);
  }

  // ---------------------------------------------------------------------------
  // Search (100 quota units per call — prefer cached/database search where possible)
  // ---------------------------------------------------------------------------

  async search(params: SearchParams): Promise<Page<YouTubeSearchResult>> {
    const parsed = searchParamsSchema.safeParse(params);
    if (!parsed.success) throw new ValidationError("Invalid search parameters", z.treeifyError(parsed.error));
    const p = parsed.data;
    if (!p.q && !p.channelId) throw new ValidationError("Search requires a query (q) or a channelId");

    const videoOnly = p.type === "video";
    const response = await this.client.get(
      "search",
      {
        part: "snippet",
        q: p.q,
        type: p.type,
        order: p.order,
        channelId: p.channelId,
        publishedAfter: p.publishedAfter,
        publishedBefore: p.publishedBefore,
        regionCode: p.regionCode?.toUpperCase(),
        relevanceLanguage: p.relevanceLanguage,
        videoDuration: videoOnly ? p.videoDuration : undefined,
        videoCategoryId: videoOnly ? p.videoCategoryId : undefined,
        safeSearch: p.safeSearch,
        maxResults: p.maxResults,
        pageToken: p.pageToken,
      },
      searchList,
    );
    const items = response.items.flatMap((raw) => mapSearchResult(raw) ?? []);
    return pageFrom(items, response);
  }

  /** Video search hydrated with full metadata and statistics (search + videos.list). */
  async searchVideos(params: Omit<SearchParams, "type">): Promise<Page<YouTubeVideo>> {
    const results = await this.search({ ...params, type: "video" });
    const videos = await this.getVideos(results.items.map((r) => r.id));
    return { ...results, items: videos };
  }

  /** Channel search hydrated with full metadata and statistics (search + channels.list). */
  async searchChannels(params: Omit<SearchParams, "type">): Promise<Page<YouTubeChannel>> {
    const results = await this.search({ ...params, type: "channel" });
    const channels = await this.getChannels(results.items.map((r) => r.id));
    return { ...results, items: channels };
  }

  // ---------------------------------------------------------------------------
  // Playlists
  // ---------------------------------------------------------------------------

  async getPlaylist(idOrUrl: string): Promise<YouTubePlaylist> {
    const id = parsePlaylistId(idOrUrl);
    const response = await this.client.get("playlists", { part: ["snippet", "contentDetails", "status"], id }, playlistList);
    const raw = response.items[0];
    if (!raw) throw new NotFoundError("YouTube playlist", id);
    return mapPlaylist(raw);
  }

  async getPlaylistItems(idOrUrl: string, options: PageOptions = {}): Promise<Page<YouTubePlaylistItem>> {
    const playlistId = parsePlaylistId(idOrUrl);
    const response = await this.client.get(
      "playlistItems",
      {
        part: ["snippet", "contentDetails"],
        playlistId,
        maxResults: clampMaxResults(options.maxResults),
        pageToken: options.pageToken,
      },
      playlistItemList,
    );
    return pageFrom(
      response.items.flatMap((raw) => mapPlaylistItem(raw) ?? []),
      response,
    );
  }

  /** Playlist items hydrated into full videos. */
  async getPlaylistVideos(idOrUrl: string, options: PageOptions = {}): Promise<Page<YouTubeVideo>> {
    const items = await this.getPlaylistItems(idOrUrl, options);
    const videos = await this.getVideos(items.items.map((i) => i.videoId));
    return { ...items, items: videos };
  }
}
