import { AppError, ValidationError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";
import { channelToRow, type ChannelRepository } from "@/lib/database/repositories/channels";
import type { NicheRepository } from "@/lib/database/repositories/niches";
import type { UsageRepository } from "@/lib/database/repositories/usage";
import { videoToRow, type VideoRepository } from "@/lib/database/repositories/videos";
import type { EnqueueOptions } from "@/lib/jobs/queue";
import { buildNicheReport, topicKey, type NicheReport } from "@/lib/niches/analysis";
import { isQuotaUnavailable } from "@/lib/youtube/quota-manager";
import type { YouTubeService } from "@/lib/youtube/service";
import type { Json } from "@/types/database";
import type { CreditsService } from "./credits-service";
import type { StorageBudgetService } from "./storage-budget-service";

/**
 * Niche Finder, database-first:
 *
 *   report cache (shared, 6h) → stored videos/channels → YouTube only when the
 *   stored sample is too thin, at most once per topic per day across all users
 *   (one search.list + one batched channels.list ≈ 102 units) → store → analyze.
 *
 * Every YouTube request goes through the normal quota gate; if quota is
 * unavailable the report is built from stored data and flagged as possibly older.
 */

export const NICHE_SEARCH_EVENT = "niche.search";
export const NICHE_REFRESH_EVENT = "niche.youtube_refresh";

export interface NicheConfig {
  /** Reuse a computed report for this long. */
  reportTtlMs: number;
  /** A topic can be refreshed from YouTube at most this often (all users combined). */
  youtubeRefreshMs: number;
  /** YouTube refreshes per UTC day across all topics (each ≈ 102 units). */
  dailyYoutubeRefreshes: number;
  /** Stored sample needed before skipping YouTube. */
  minVideos: number;
  minChannels: number;
  sampleDays: number;
  language?: string;
  regionCode?: string;
}

export const DEFAULT_NICHE_CONFIG: NicheConfig = {
  reportTtlMs: 6 * 3_600_000,
  youtubeRefreshMs: 24 * 3_600_000,
  dailyYoutubeRefreshes: 15,
  minVideos: 40,
  minChannels: 8,
  sampleDays: 90,
};

export type NicheSource = "cache" | "database" | "youtube";

export interface NicheResult {
  topic: string;
  topicKey: string;
  report: NicheReport;
  source: NicheSource;
  computedAt: string;
  youtubeRefreshedAt: string | null;
  /** YouTube quota units this request spent (0 for cached/database answers). */
  unitsSpent: number;
  /** Why the answer may be older or thinner than ideal. */
  notice: string | null;
  stale: boolean;
}

export class NicheService {
  private readonly log: Logger;
  private readonly config: NicheConfig;
  /** Identical in-flight requests in this process share one computation. */
  private readonly inflight = new Map<string, Promise<NicheResult>>();

  constructor(
    private readonly deps: {
      niches: Pick<NicheRepository, "getReport" | "saveReport" | "claimRefresh" | "releaseClaim" | "topicSample" | "popularTopics">;
      youtube: Pick<YouTubeService, "searchVideos" | "getChannels">;
      channels: Pick<ChannelRepository, "upsertMany">;
      videos: Pick<VideoRepository, "upsertMany">;
      usage: Pick<UsageRepository, "record" | "countSince">;
      credits?: Pick<CreditsService, "status" | "charge">;
      storage?: Pick<StorageBudgetService, "assertCapacity">;
      enqueue?: (type: string, payload: unknown, options?: EnqueueOptions) => Promise<unknown>;
    },
    config: Partial<NicheConfig> = {},
    logger?: Logger,
  ) {
    this.config = { ...DEFAULT_NICHE_CONFIG, ...config };
    this.log = logger ?? createLogger({ module: "services.niche" });
  }

  popularTopics(limit = 8) {
    return this.deps.niches.popularTopics(limit).catch(() => []);
  }

  research(topic: string, options: { userId: string | null; now?: Date } = { userId: null }): Promise<NicheResult> {
    const clean = topic.trim().replace(/\s+/g, " ");
    const key = topicKey(clean);
    if (key.length < 2 || clean.length > 60) throw new ValidationError("Enter a topic between 2 and 60 characters.");
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const run = this.run(clean, key, options.userId, options.now ?? new Date()).finally(() => this.inflight.delete(key));
    this.inflight.set(key, run);
    return run;
  }

  private async run(topic: string, key: string, userId: string | null, now: Date): Promise<NicheResult> {
    const cached = await this.deps.niches.getReport(key);

    // 1. Shared cache.
    if (cached?.computed_at && now.getTime() - Date.parse(cached.computed_at) < this.config.reportTtlMs && isReport(cached.report)) {
      await this.saveSearch(key, topic, cached, now, null);
      await this.recordSearch(userId, key, "cache", 0, now);
      return {
        topic: cached.topic,
        topicKey: key,
        report: cached.report,
        source: "cache",
        computedAt: cached.computed_at,
        youtubeRefreshedAt: cached.youtube_refreshed_at,
        unitsSpent: 0,
        notice: null,
        stale: false,
      };
    }

    // 2. Stored data.
    const since = new Date(now.getTime() - this.config.sampleDays * 86_400_000);
    let sample = await this.deps.niches.topicSample(topic, since);
    let source: NicheSource = "database";
    let unitsSpent = 0;
    let notice: string | null = null;
    let stale = false;
    let youtubeRefreshedAt = cached?.youtube_refreshed_at ?? null;

    const thin = sample.videos.length < this.config.minVideos || sample.channels.size < this.config.minChannels;
    const refreshedRecently = youtubeRefreshedAt !== null && now.getTime() - Date.parse(youtubeRefreshedAt) < this.config.youtubeRefreshMs;

    // 3. YouTube, only when the stored sample is too thin.
    if (thin && !refreshedRecently) {
      const outcome = await this.tryRefreshFromYouTube(topic, key, userId, now);
      if (outcome.status === "refreshed") {
        source = "youtube";
        unitsSpent = outcome.units;
        youtubeRefreshedAt = now.toISOString();
        sample = await this.deps.niches.topicSample(topic, since);
      } else {
        notice = outcome.notice;
        stale = outcome.status === "quota";
      }
    } else if (thin) {
      notice = "Limited data for this topic so far. Results fill in as more channels are tracked.";
    }

    const report = buildNicheReport(topic, sample.videos, sample.channels, now);
    if (report.overall.videos === 0 && !notice) notice = "No stored videos match this topic yet.";

    await this.saveSearch(key, topic, cached, now, {
      report,
      source: source === "youtube" ? "youtube" : "database",
      videos: sample.videos.length,
      channels: sample.channels.size,
      units: unitsSpent,
      youtubeRefreshedAt,
    });
    await this.recordSearch(userId, key, source, unitsSpent, now);
    this.log.info("niche researched", { topic: key, source, units: unitsSpent, videos: sample.videos.length, channels: sample.channels.size, stale });

    return { topic, topicKey: key, report, source, computedAt: now.toISOString(), youtubeRefreshedAt, unitsSpent, notice, stale };
  }

  private async tryRefreshFromYouTube(
    topic: string,
    key: string,
    userId: string | null,
    now: Date,
  ): Promise<{ status: "refreshed"; units: number } | { status: "skipped" | "quota"; notice: string }> {
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if ((await this.deps.usage.countSince(NICHE_REFRESH_EVENT, dayStart)) >= this.config.dailyYoutubeRefreshes) {
      return { status: "skipped", notice: "Showing stored data only: today's fresh-research limit was reached. Try again tomorrow for newer data." };
    }
    if (userId && this.deps.credits) {
      const status = await this.deps.credits.status(userId, now);
      if (status.remaining < NICHE_REFRESH_CREDITS) {
        return { status: "skipped", notice: `Showing stored data only: fresh research needs ${NICHE_REFRESH_CREDITS} credits.` };
      }
    }
    try {
      await this.deps.storage?.assertCapacity();
    } catch {
      return { status: "skipped", notice: "Showing stored data only: storage is near its limit." };
    }
    // Another request (any user) is already refreshing, or just did.
    if (!(await this.deps.niches.claimRefresh(key, topic, new Date(now.getTime() - this.config.youtubeRefreshMs), 120))) {
      return { status: "skipped", notice: "Fresh data for this topic is being gathered. Showing what's stored now." };
    }

    try {
      // One search (100 units) hydrated with batched video stats (1 unit), then channels in one batch (1 unit).
      const results = await this.deps.youtube.searchVideos({
        q: topic,
        order: "viewCount",
        publishedAfter: new Date(now.getTime() - 30 * 86_400_000).toISOString(),
        relevanceLanguage: this.config.language,
        regionCode: this.config.regionCode,
        maxResults: 50,
      });
      const channelIds = [...new Set(results.items.map((v) => v.channelId).filter(Boolean))];
      const channels = channelIds.length ? await this.deps.youtube.getChannels(channelIds) : [];
      const units = 101 + (channelIds.length ? 1 : 0);

      const saved = await this.deps.channels.upsertMany(channels.map((c) => ({ ...channelToRow(c, now), last_synced_at: undefined })));
      const uuidByYoutubeId = new Map(saved.map((c) => [c.youtube_channel_id, c.id]));
      await this.deps.videos.upsertMany(
        results.items.flatMap((v) => {
          const channelUuid = uuidByYoutubeId.get(v.channelId);
          return channelUuid ? [videoToRow(v, channelUuid, now, { storeDescription: false })] : [];
        }),
      );

      await this.deps.usage.record({
        event_type: NICHE_REFRESH_EVENT,
        user_id: userId,
        quantity: 1,
        resource_type: "niche",
        resource_id: key,
        metadata: { units, videos: results.items.length, channels: channels.length } as Json,
        occurred_at: now.toISOString(),
      });
      if (userId && this.deps.credits) await this.deps.credits.charge(userId, "niche_research", key, now);

      // Fill in each channel's own uploads later, from the background budget.
      for (const channel of saved.slice(0, 10)) {
        await this.deps.enqueue?.(
          "channel.refresh",
          { channelId: channel.youtube_channel_id, light: true },
          { idempotencyKey: `channel.refresh:${channel.youtube_channel_id}:${now.toISOString().slice(0, 10)}`, priority: -5 },
        );
      }
      return { status: "refreshed", units };
    } catch (error) {
      await this.deps.niches.releaseClaim(key).catch(() => {});
      if (isQuotaUnavailable(error)) {
        return { status: "quota", notice: "YouTube data is at its daily limit, so this uses stored data that may be older." };
      }
      if (error instanceof AppError && error.expose) {
        this.log.warn("niche youtube refresh failed", { topic: key, error });
        return { status: "skipped", notice: "Couldn't fetch fresh data right now. Showing stored data." };
      }
      throw error;
    }
  }

  private async saveSearch(
    key: string,
    topic: string,
    cached: Awaited<ReturnType<NicheRepository["getReport"]>>,
    now: Date,
    computed: { report: NicheReport; source: "database" | "youtube"; videos: number; channels: number; units: number; youtubeRefreshedAt: string | null } | null,
  ): Promise<void> {
    try {
      await this.deps.niches.saveReport({
        topic_key: key,
        topic: cached?.topic ?? topic,
        search_count: (cached?.search_count ?? 0) + 1,
        last_searched_at: now.toISOString(),
        ...(computed
          ? {
              report: computed.report as unknown as Json,
              source: computed.source,
              videos_analyzed: computed.videos,
              channels_analyzed: computed.channels,
              youtube_units: (cached?.youtube_units ?? 0) + computed.units,
              computed_at: now.toISOString(),
              youtube_refreshed_at: computed.youtubeRefreshedAt,
              refresh_claimed_at: null,
            }
          : {}),
      });
    } catch (error) {
      this.log.warn("niche report save failed", { topic: key, error });
    }
  }

  private async recordSearch(userId: string | null, key: string, source: NicheSource, units: number, now: Date): Promise<void> {
    await this.deps.usage
      .record({
        event_type: NICHE_SEARCH_EVENT,
        user_id: userId,
        quantity: 1,
        resource_type: "niche",
        resource_id: key,
        metadata: { source, units } as Json,
        occurred_at: now.toISOString(),
      })
      .catch((error: unknown) => this.log.warn("niche search event failed", { error }));
  }
}

export const NICHE_REFRESH_CREDITS = 5;

function isReport(value: unknown): value is NicheReport {
  return typeof value === "object" && value !== null && "overall" in value && "subNiches" in value;
}
