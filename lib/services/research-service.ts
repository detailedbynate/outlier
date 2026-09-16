import { AppError, ValidationError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { ChannelRepository, ShortsChannelFilters } from "@/lib/database/repositories/channels";
import type { UsageRepository } from "@/lib/database/repositories/usage";
import type { VideoPreview, VideoRepository } from "@/lib/database/repositories/videos";
import type { EnqueueOptions } from "@/lib/jobs/queue";
import { DEFAULT_QUALITY, rejectReason, underratedScore, type QualityConfig } from "@/lib/research/quality";
import { keywordTokens, mentionsKeywords } from "@/lib/research/relevance";
import type { YouTubeService } from "@/lib/youtube/service";
import type { ShortsChannelRow } from "@/types/database";
import type { StorageBudgetService } from "./storage-budget-service";

export const SHORTS_DISCOVERY_EVENT = "research.shorts_discovery";
/** Discovery the library-growth job runs; kept apart so it never uses up users' daily searches. */
export const LIBRARY_GROWTH_EVENT = "research.library_growth";

const DISCOVERY_MIN_VIEWS = 20_000;

/** A paid discovery should be worth it: keep searching until this many channels are ones we don't have. */
const MIN_NEW_CHANNELS = 7;
/** Each pass is one search.list call (100 units), so cap how deep a single discovery digs. */
const MAX_SEARCH_PASSES = 3;

const DEFAULT_KEYWORDS = ["motivation", "cooking", "minecraft", "fitness", "facts", "roblox", "skincare", "finance", "pets", "comedy"];

export type ShortsChannelWithPreviews = ShortsChannelRow & { recentShorts: VideoPreview[] };

/** Split "recipe, cooking, food" into up to 3 distinct search terms. */
export function parseSearchTerms(query: string): string[] {
  const terms = query
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 2)
    .map((t) => t.slice(0, 50));
  return [...new Set(terms)].slice(0, 3);
}

export interface ResearchConfig {
  /** Quality rules for discovered channels (defaults to DEFAULT_QUALITY). */
  quality?: QualityConfig;
  /** YouTube search region, e.g. "US". */
  regionCode?: string;
  /** Discovery searches allowed per UTC day across all users (each costs 100 YouTube quota units). */
  discoveryDailyLimit: number;
  /** Max new channels ingested per discovery search. */
  discoveryMaxChannels: number;
}

export interface DiscoveryResult {
  keyword: string;
  channelsFound: number;
  /** Channels nobody had discovered before this search. */
  channelsNew: number;
  channelsQueued: number;
  alreadyFresh: number;
  searchesLeftToday: number;
  /** search.list calls this discovery made. */
  searchPasses: number;
}

/** Channels from the newest discovery for this search first, in the order that search ranked them. */
function sortNewestFirst<T extends { channel_id: string }>(rows: T[], newestFirst: string[]): T[] {
  if (newestFirst.length === 0) return rows;
  const rank = new Map(newestFirst.map((id, index) => [id, index]));
  return [...rows].sort((a, b) => (rank.get(a.channel_id) ?? Infinity) - (rank.get(b.channel_id) ?? Infinity));
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Research tools: find channels by niche and browse the catalog with filters. */
export class ResearchService {
  private readonly log: Logger;

  constructor(
    private readonly deps: {
      youtube: YouTubeService;
      channels: ChannelRepository;
      usage: UsageRepository;
      videos?: Pick<VideoRepository, "latestShortsByChannel">;
      storage: Pick<StorageBudgetService, "assertCapacity">;
      enqueue: (type: string, payload: unknown, options?: EnqueueOptions) => Promise<unknown>;
    },
    private readonly config: ResearchConfig,
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger({ module: "services.research" });
  }

  searchShortsChannels(filters: ShortsChannelFilters): Promise<ShortsChannelRow[]> {
    return this.deps.channels.searchShortsChannels(filters);
  }

  /**
   * Browse Shorts channels: optional keyword search ("recipe, cooking, food" = any
   * of those terms in channel names, descriptions, or video titles), filters, and
   * each channel's latest Shorts for previews.
   */
  async browseShortsChannels(
    query: string,
    filters: Omit<ShortsChannelFilters, "channelIds">,
    previewsPerChannel: number,
    now: Date = new Date(),
  ): Promise<{ channels: ShortsChannelWithPreviews[]; terms: string[] }> {
    const terms = parseSearchTerms(query);
    const match = terms.length > 0 ? await this.channelIdsFor(query, terms, now) : null;
    const rows = sortNewestFirst(await this.deps.channels.searchShortsChannels({ ...filters, channelIds: match?.ids }), match?.newestFirst ?? []);
    const previews =
      previewsPerChannel > 0 && this.deps.videos
        ? await this.deps.videos.latestShortsByChannel(rows.map((r) => r.channel_id), previewsPerChannel)
        : new Map<string, VideoPreview[]>();
    return {
      terms,
      channels: rows.map((row) => ({ ...row, recentShorts: previews.get(row.channel_id) ?? [] })),
    };
  }

  /**
   * Channels matching the search: keyword matches on what we store, plus the
   * channels discovery pulled in for this exact search, which may not mention
   * the keyword anywhere yet.
   */
  private async channelIdsFor(query: string, terms: string[], now: Date): Promise<{ ids: string[]; newestFirst: string[] }> {
    const keyword = query.trim().toLowerCase().slice(0, 100);
    const [byText, byNiche, discoveries] = await Promise.all([
      this.deps.channels.findChannelIdsByKeywords(terms),
      // Labeled channels match on what they're about, even when no title says it.
      Promise.all(terms.map((term) => this.deps.channels.findChannelIdsByNiche(term))).then((lists) => lists.flat()),
      this.deps.usage.discoveriesFor(SHORTS_DISCOVERY_EVENT, keyword, new Date(now.getTime() - 30 * 86_400_000)),
    ]);
    const byKeyword = [...new Set([...byNiche, ...byText])];
    const discovered = [...new Set(discoveries.flatMap((d) => d.channelIds))];
    if (discovered.length === 0) return { ids: byKeyword, newestFirst: [] };

    const rows = await this.deps.channels.findByIdentifiers(discovered, []);
    const idByYouTubeId = new Map(rows.map((row) => [row.youtube_channel_id, row.id]));
    // Whatever the latest search turned up goes to the top of the list.
    const newestFirst = (discoveries[0]?.channelIds ?? []).flatMap((ytId) => idByYouTubeId.get(ytId) ?? []);
    return { ids: [...new Set([...byKeyword, ...idByYouTubeId.values()])], newestFirst };
  }

  /** Keywords people discovered most in the last week, padded with evergreen niches. */
  async popularKeywords(limit = 10, now: Date = new Date()): Promise<string[]> {
    const recent = await this.deps.usage.topResources(SHORTS_DISCOVERY_EVENT, new Date(now.getTime() - 7 * 86_400_000), limit);
    const merged = [...recent];
    for (const keyword of DEFAULT_KEYWORDS) {
      if (merged.length >= limit) break;
      if (!merged.includes(keyword)) merged.push(keyword);
    }
    return merged;
  }

  async discoverySearchesLeftToday(now: Date = new Date()): Promise<number> {
    const used = await this.deps.usage.countSince(SHORTS_DISCOVERY_EVENT, startOfUtcDay(now));
    return Math.max(this.config.discoveryDailyLimit - used, 0);
  }

  /**
   * Find channels posting popular Shorts for a keyword and queue them for a light
   * sync. Candidates must pass the quality rules (language, country, no junk,
   * real engagement); the Shorts channels view then decides which qualify.
   * Quota: 100 (search) + 1 (videos) + 1 (channels) now, then ~4 per queued channel.
   */
  async discoverShortsChannels(
    keyword: string,
    userId: string | null,
    now: Date = new Date(),
    options: { source?: "user" | "growth" } = {},
  ): Promise<DiscoveryResult> {
    const q = keyword.trim();
    if (q.length < 2 || q.length > 100) throw new ValidationError("Enter a keyword between 2 and 100 characters.");

    const growth = options.source === "growth";
    // Growth runs in the background lane and has its own daily cap in the growth service.
    const left = growth ? 0 : await this.discoverySearchesLeftToday(now);
    if (!growth && left <= 0) {
      throw new AppError("RATE_LIMITED", `Daily discovery limit reached (${this.config.discoveryDailyLimit} searches). Try again tomorrow.`);
    }
    await this.deps.storage.assertCapacity();

    // Discovery covers whole niches, so allow smaller hits than Trending Today.
    const base = this.config.quality ?? DEFAULT_QUALITY;
    const quality = { ...base, minViews: Math.min(base.minViews, DISCOVERY_MIN_VIEWS) };

    const tokens = keywordTokens(q);
    const bestScore = new Map<string, number>();
    // Search order is YouTube's relevance ranking; keep it for what we show first.
    const seenOrder: string[] = [];
    let rejected = 0;
    let offTopic = 0;
    let passes = 0;
    let seen = 0;
    let newIds: string[] = [];
    let ranked: string[] = [];
    let pageToken: string | undefined;

    // Each pass looks somewhere the last one didn't, so a repeat search doesn't
    // hand back the same channels everyone has already seen.
    for (let pass = 0; pass < MAX_SEARCH_PASSES; pass++) {
      const plan = this.searchPass(pass, pageToken, now);
      const results = await this.deps.youtube.searchVideos({ ...plan, q, videoDuration: "short", relevanceLanguage: quality.language, regionCode: this.config.regionCode, maxResults: 50 });
      passes += 1;
      pageToken = results.nextPageToken ?? undefined;

      const channels = await this.deps.youtube.getChannels([...new Set(results.items.map((v) => v.channelId).filter(Boolean))]);
      const channelById = new Map(channels.map((c) => [c.id, c]));
      for (const video of results.items) {
        const channel = channelById.get(video.channelId);
        if (!channel) continue;
        if (rejectReason(video, channel, quality, { sizeRules: false })) {
          rejected += 1;
          continue;
        }
        // The video or the channel has to be about what was searched for.
        const text = [video.title, video.description, video.tags.join(" "), channel.title, channel.description].join(" ");
        if (!mentionsKeywords(text, tokens)) {
          offTopic += 1;
          continue;
        }
        if (!bestScore.has(channel.id)) seenOrder.push(channel.id);
        bestScore.set(channel.id, Math.max(bestScore.get(channel.id) ?? 0, underratedScore(video, channel)));
      }

      const grew = bestScore.size > seen;
      seen = bestScore.size;
      ranked = [...bestScore.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
      const known = await this.deps.channels.existingIds(ranked);
      newIds = ranked.filter((id) => !known.has(id));
      if (newIds.length >= MIN_NEW_CHANNELS) break;
      // A pass that turned up nothing new means the niche is thin; stop paying for more.
      if (pass > 0 && !grew) break;
    }

    await this.deps.usage.record({
      event_type: growth ? LIBRARY_GROWTH_EVENT : SHORTS_DISCOVERY_EVENT,
      user_id: userId,
      quantity: 1,
      resource_type: "keyword",
      resource_id: q.slice(0, 100),
      metadata: { found: ranked.length, new: newIds.length, offTopic, passes, channelIds: seenOrder.slice(0, 50) },
    });

    // New channels first, then anything we have but haven't refreshed in a week.
    const stale = ranked.filter((id) => !newIds.includes(id));
    const fresh = await this.deps.channels.recentlySyncedIds(stale, new Date(now.getTime() - 7 * 86_400_000));
    const toQueue = [...newIds, ...stale.filter((id) => !fresh.has(id))].slice(0, this.config.discoveryMaxChannels);
    const day = now.toISOString().slice(0, 10);
    for (const channelId of toQueue) {
      await this.deps.enqueue("channel.refresh", { channelId, light: true }, { idempotencyKey: `channel.refresh:${channelId}:${day}`, priority: 5 });
    }

    this.log.info("shorts discovery", { keyword: q, found: ranked.length, new: newIds.length, rejected, offTopic, queued: toQueue.length, passes });
    return {
      keyword: q,
      channelsFound: ranked.length,
      channelsNew: newIds.length,
      channelsQueued: toQueue.length,
      alreadyFresh: fresh.size,
      searchesLeftToday: growth ? 0 : left - 1,
      searchPasses: passes,
    };
  }

  /** Where each pass looks: the next page first, then a different ordering and window. */
  private searchPass(pass: number, pageToken: string | undefined, now: Date): { order: "viewCount" | "relevance" | "date"; publishedAfter: string; pageToken?: string } {
    const daysBack = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
    if (pass === 0) return { order: "viewCount", publishedAfter: daysBack(90) };
    if (pass === 1 && pageToken) return { order: "viewCount", publishedAfter: daysBack(90), pageToken };
    if (pass === 1) return { order: "relevance", publishedAfter: daysBack(90) };
    return { order: "date", publishedAfter: daysBack(30) };
  }

}
