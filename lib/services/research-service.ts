import { AppError, ValidationError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { ChannelRepository, ShortsChannelFilters } from "@/lib/database/repositories/channels";
import type { UsageRepository } from "@/lib/database/repositories/usage";
import type { VideoPreview, VideoRepository } from "@/lib/database/repositories/videos";
import type { EnqueueOptions } from "@/lib/jobs/queue";
import type { YouTubeService } from "@/lib/youtube/service";
import type { ShortsChannelRow } from "@/types/database";
import type { StorageBudgetService } from "./storage-budget-service";

export const SHORTS_DISCOVERY_EVENT = "research.shorts_discovery";

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
  /** Discovery searches allowed per UTC day across all users (each costs 100 YouTube quota units). */
  discoveryDailyLimit: number;
  /** Max new channels ingested per discovery search. */
  discoveryMaxChannels: number;
}

export interface DiscoveryResult {
  keyword: string;
  channelsFound: number;
  channelsQueued: number;
  alreadyFresh: number;
  searchesLeftToday: number;
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
  ): Promise<{ channels: ShortsChannelWithPreviews[]; terms: string[] }> {
    const terms = parseSearchTerms(query);
    const channelIds = terms.length > 0 ? await this.deps.channels.findChannelIdsByKeywords(terms) : undefined;
    const rows = await this.deps.channels.searchShortsChannels({ ...filters, channelIds });
    const previews =
      previewsPerChannel > 0 && this.deps.videos
        ? await this.deps.videos.latestShortsByChannel(rows.map((r) => r.channel_id), previewsPerChannel)
        : new Map<string, VideoPreview[]>();
    return {
      terms,
      channels: rows.map((row) => ({ ...row, recentShorts: previews.get(row.channel_id) ?? [] })),
    };
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
   * sync. The Shorts channels view decides which ones actually qualify.
   * Quota: 100 (search) + 1 (channel hydrate) now, then ~4 per queued channel.
   */
  async discoverShortsChannels(keyword: string, userId: string | null, now: Date = new Date()): Promise<DiscoveryResult> {
    const q = keyword.trim();
    if (q.length < 2 || q.length > 100) throw new ValidationError("Enter a keyword between 2 and 100 characters.");

    const left = await this.discoverySearchesLeftToday(now);
    if (left <= 0) {
      throw new AppError("RATE_LIMITED", `Daily discovery limit reached (${this.config.discoveryDailyLimit} searches). Try again tomorrow.`);
    }
    await this.deps.storage.assertCapacity();

    const results = await this.deps.youtube.search({
      q,
      type: "video",
      videoDuration: "short",
      order: "viewCount",
      publishedAfter: new Date(now.getTime() - 90 * 86_400_000).toISOString(),
      maxResults: 50,
    });
    await this.deps.usage.record({
      event_type: SHORTS_DISCOVERY_EVENT,
      user_id: userId,
      quantity: 1,
      resource_type: "keyword",
      resource_id: q.slice(0, 100),
      metadata: { results: results.items.length },
    });

    // Rank channels by how many of the top results they own.
    const hits = new Map<string, number>();
    for (const item of results.items) if (item.channelId) hits.set(item.channelId, (hits.get(item.channelId) ?? 0) + 1);
    const channelIds = [...hits.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);

    const fresh = await this.deps.channels.recentlySyncedIds(channelIds, new Date(now.getTime() - 7 * 86_400_000));
    const toQueue = channelIds.filter((id) => !fresh.has(id)).slice(0, this.config.discoveryMaxChannels);
    const day = now.toISOString().slice(0, 10);
    for (const channelId of toQueue) {
      await this.deps.enqueue("channel.refresh", { channelId, light: true }, { idempotencyKey: `channel.refresh:${channelId}:${day}`, priority: 5 });
    }

    this.log.info("shorts discovery", { keyword: q, found: channelIds.length, queued: toQueue.length });
    return {
      keyword: q,
      channelsFound: channelIds.length,
      channelsQueued: toQueue.length,
      alreadyFresh: fresh.size,
      searchesLeftToday: left - 1,
    };
  }
}
