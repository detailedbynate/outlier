import { createLogger, type Logger } from "@/lib/core/logger";
import type { ChannelRepository } from "@/lib/database/repositories/channels";
import type { EnqueueOptions } from "@/lib/jobs/queue";
import type { YouTubeService } from "@/lib/youtube/service";
import type { NicheRepository } from "@/lib/database/repositories/niches";
import type { UsageRepository } from "@/lib/database/repositories/usage";
import { nicheSlug } from "@/lib/niches/labeling";
import { isQuotaUnavailable } from "@/lib/youtube/quota-manager";
import { LIBRARY_GROWTH_EVENT, longSeedKey, type ResearchService } from "./research-service";

export interface LibraryGrowthConfig {
  /** Discovery searches per run (each is 100-300 quota units plus channel syncs). */
  searchesPerRun: number;
  /** Discovery searches per UTC day across all runs. */
  dailySearches: number;
  /** Don't search the same seed again within this many days. */
  reseedDays: number;
  /** Channels whose featured channels are checked per run (1 quota unit each). 0 turns it off. */
  featuredChecksPerRun: number;
  /** New channels queued from featured channels per run (each costs a few units to import). */
  featuredNewPerRun: number;
  /** Only follow channels smaller than this: big channels feature big channels. */
  featuredMaxSubscribers: number;
}

export interface GrowthRunResult {
  searched: string[];
  channelsNew: number;
  channelsQueued: number;
  stoppedBy?: "daily_cap" | "quota" | "no_seeds";
  /** Channels whose featured channels were checked this run. */
  featuredChecked: number;
  /** New creators found through featured channels and queued for import. */
  featuredQueued: number;
}

const DAY = 86_400_000;

export interface GrowthSearch {
  seed: string;
  duration: "short" | "long";
}

/**
 * Grows the channel library on a schedule by running Shorts discovery for seed
 * niches the library is thinnest on. Runs in the background quota lane, so it
 * yields to users when quota is tight.
 */
export class LibraryGrowthService {
  private readonly log: Logger;

  constructor(
    private readonly deps: {
      research: Pick<ResearchService, "discoverShortsChannels">;
      usage: Pick<UsageRepository, "countSince" | "topResources">;
      niches: Pick<NicheRepository, "channelCountsBySlug">;
      seeds: readonly string[];
      /** Seeds also searched for long-form videos. Without it, growth is Shorts only. */
      longFormSeeds?: readonly string[];
      /** Seeds found at run time (the radar's best phrases), searched in both formats. */
      extraSeeds?: () => Promise<string[]>;
      youtube: Pick<YouTubeService, "getFeaturedChannels">;
      channels: Pick<ChannelRepository, "listForFeaturedCheck" | "markFeaturedChecked" | "existingIds">;
      enqueue: (type: string, payload: unknown, options?: EnqueueOptions) => Promise<unknown>;
    },
    private readonly config: LibraryGrowthConfig,
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger({ module: "services.library_growth" });
  }

  /**
   * Creators feature peers in their niche on their channel page. Follow those links
   * from confidently labeled, not-huge channels and queue creators we don't have.
   * Returns true when YouTube quota ran out.
   */
  private async followFeatured(result: GrowthRunResult, now: Date, signal?: AbortSignal): Promise<boolean> {
    if (this.config.featuredChecksPerRun <= 0) return false;
    const sources = await this.deps.channels.listForFeaturedCheck(this.config.featuredChecksPerRun, this.config.featuredMaxSubscribers);
    const checked: string[] = [];
    const day = now.toISOString().slice(0, 10);
    let quotaOut = false;

    for (const source of sources) {
      if (signal?.aborted || result.featuredQueued >= this.config.featuredNewPerRun) break;
      try {
        const featured = await this.deps.youtube.getFeaturedChannels(source.youtube_channel_id);
        checked.push(source.id);
        if (featured.length === 0) continue;
        const known = await this.deps.channels.existingIds(featured);
        for (const channelId of featured.filter((id) => !known.has(id))) {
          if (result.featuredQueued >= this.config.featuredNewPerRun) break;
          await this.deps.enqueue("channel.refresh", { channelId, light: true }, { idempotencyKey: `channel.refresh:${channelId}:${day}`, priority: 3 });
          result.featuredQueued += 1;
        }
      } catch (error) {
        if (isQuotaUnavailable(error)) {
          quotaOut = true;
          break;
        }
        // A deleted or private channel: don't try it again.
        checked.push(source.id);
        this.log.warn("featured channels lookup failed", { channelId: source.youtube_channel_id, error });
      }
    }

    await this.deps.channels.markFeaturedChecked(checked, now);
    result.featuredChecked = checked.length;
    return quotaOut;
  }

  /**
   * Searches in the order they should run: fewest labeled channels first,
   * never-searched before recently searched, Shorts and long-form taking turns.
   */
  async plan(now: Date): Promise<GrowthSearch[]> {
    const recent = new Set(
      (await this.deps.usage.topResources(LIBRARY_GROWTH_EVENT, new Date(now.getTime() - this.config.reseedDays * DAY), 1_000)).map((k) => k.toLowerCase()),
    );
    const order = async (seeds: readonly string[], duration: GrowthSearch["duration"]) => {
      const due = seeds.filter((seed) => !recent.has((duration === "long" ? longSeedKey(seed) : seed).toLowerCase()));
      const counts = await this.deps.niches.channelCountsBySlug(due.map(nicheSlug));
      return due
        .map((seed, index) => ({ seed, index, channels: counts.get(nicheSlug(seed)) ?? 0 }))
        .sort((a, b) => a.channels - b.channels || a.index - b.index)
        .map((entry) => ({ seed: entry.seed, duration }));
    };
    const extra = (await this.deps.extraSeeds?.().catch(() => [])) ?? [];
    const shorts = await order([...new Set([...this.deps.seeds, ...extra])], "short");
    const longSeeds = [...new Set([...(this.deps.longFormSeeds ?? []), ...extra])];
    const long = longSeeds.length ? await order(longSeeds, "long") : [];
    const queue: GrowthSearch[] = [];
    for (let i = 0; i < Math.max(shorts.length, long.length); i++) {
      if (shorts[i]) queue.push(shorts[i]!);
      if (long[i]) queue.push(long[i]!);
    }
    return queue;
  }

  async growOnce(options: { now?: Date; signal?: AbortSignal } = {}): Promise<GrowthRunResult> {
    const now = options.now ?? new Date();
    const result: GrowthRunResult = { searched: [], channelsNew: 0, channelsQueued: 0, featuredChecked: 0, featuredQueued: 0 };

    // Searches first, featured channels with the time left. Featured links find more creators
    // per unit, but they lead to whatever the library already has the most of (games). Run
    // first, they used up the tick's whole budget and the subject searches stopped happening.
    const stoppedBy = await this.search(result, now, options.signal);
    if (stoppedBy === "quota") return { ...result, stoppedBy };
    if (await this.followFeatured(result, now, options.signal)) return { ...result, stoppedBy: "quota" };

    this.log.info("library growth run", { ...result, ...(stoppedBy ? { stoppedBy } : {}) });
    return stoppedBy ? { ...result, stoppedBy } : result;
  }

  /** Discovery searches for the seeds the library is thinnest on. */
  private async search(result: GrowthRunResult, now: Date, signal?: AbortSignal): Promise<GrowthRunResult["stoppedBy"]> {
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const usedToday = await this.deps.usage.countSince(LIBRARY_GROWTH_EVENT, today);
    const allowed = Math.min(this.config.searchesPerRun, this.config.dailySearches - usedToday);
    if (allowed <= 0) return "daily_cap";

    const queue = await this.plan(now);
    if (queue.length === 0) return "no_seeds";

    for (const { seed, duration } of queue.slice(0, allowed)) {
      if (signal?.aborted) break;
      try {
        const found = await this.deps.research.discoverShortsChannels(seed, null, now, { source: "growth", duration });
        result.searched.push(duration === "long" ? longSeedKey(seed) : seed);
        result.channelsNew += found.channelsNew;
        result.channelsQueued += found.channelsQueued;
      } catch (error) {
        if (isQuotaUnavailable(error)) return "quota";
        this.log.warn("library growth search failed", { seed, error });
      }
    }
    return undefined;
  }
}
