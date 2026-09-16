import { AppError, ValidationError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";
import { channelToRow, type ChannelRepository } from "@/lib/database/repositories/channels";
import type { NicheRepository } from "@/lib/database/repositories/niches";
import type { UsageRepository } from "@/lib/database/repositories/usage";
import { videoToRow, type VideoRepository } from "@/lib/database/repositories/videos";
import type { EnqueueOptions } from "@/lib/jobs/queue";
import { buildNicheReport, tokenize, topicKey, type Level, type NicheReport } from "@/lib/niches/analysis";
import { findUnderratedNiches, underratedWindow } from "@/lib/niches/underrated";
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

/** A niche someone can jump into, summarised for browsing. */
export interface NicheIdea {
  topic: string;
  topicKey: string;
  opportunity: number;
  demand: Level;
  competition: Level;
  format: "shorts" | "long_form" | "both" | "unknown";
  medianViewsPerDay: number;
  growth: number | null;
  videos: number;
  channels: number;
  /** Share of the niche's views going to channels under 100K subscribers. */
  smallChannelShare: number | null;
  searchCount: number;
  computedAt: string | null;
  /** Why it's worth a look, in one line. */
  reason: string;
}

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

/** One line on why a niche is interesting, from its own numbers. */
function reasonFor(metrics: NicheReport["overall"]): string {
  if (metrics.growth !== null && metrics.growth >= 0.2) return `Growing fast · views/day up ${Math.round(metrics.growth * 100)}%`;
  if (metrics.competition === "low" && metrics.demand !== "low") return "Demand with little competition";
  if (metrics.viralRate >= 0.12) return `${Math.round(metrics.viralRate * 100)}% of uploads beat their channel's usual views`;
  if (metrics.smallChannelShare !== null && metrics.smallChannelShare >= 0.5) return "Small channels are breaking out here";
  if (metrics.demand === "high") return "High demand, steady audience";
  return "Room to grow";
}

function toIdea(row: {
  topic: string;
  topic_key: string;
  report: unknown;
  videos_analyzed: number;
  channels_analyzed: number;
  computed_at: string | null;
  search_count: number;
}): NicheIdea | null {
  const report = row.report as NicheReport | null;
  const overall = report?.overall;
  if (!overall || typeof overall.opportunity !== "number") return null;
  return {
    topic: row.topic,
    topicKey: row.topic_key,
    opportunity: overall.opportunity,
    demand: overall.demand,
    competition: overall.competition,
    format: overall.format.best,
    medianViewsPerDay: overall.medianViewsPerDay,
    growth: overall.growth,
    videos: row.videos_analyzed,
    channels: row.channels_analyzed,
    smallChannelShare: overall.smallChannelShare,
    searchCount: row.search_count,
    computedAt: row.computed_at,
    reason: reasonFor(overall),
  };
}

export class NicheService {
  private readonly log: Logger;
  private readonly config: NicheConfig;
  /** Identical in-flight requests in this process share one computation. */
  private readonly inflight = new Map<string, Promise<NicheResult>>();
  /** Mining the library is heavy, so the board is computed once per TTL. */
  private underratedCache: { at: number; ideas: NicheIdea[] } | null = null;

  constructor(
    private readonly deps: {
      niches: Pick<NicheRepository, "getReport" | "saveReport" | "claimRefresh" | "releaseClaim" | "topicSample" | "popularTopics" | "recentReports" | "recentSample">;
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

  /**
   * Niches nobody is talking about yet: terms mined from the whole stored
   * library where small channels pull real views and no one owns the space.
   * Database only - no YouTube calls - and cached for everyone.
   */
  async topNiches(limit = 12, options: { now?: Date } = {}): Promise<NicheIdea[]> {
    const now = options.now ?? new Date();
    const cached = this.underratedCache;
    if (cached && now.getTime() - cached.at < this.config.reportTtlMs) return cached.ideas.slice(0, limit);

    try {
      const { videos, channels } = await this.deps.niches.recentSample(underratedWindow(now, this.config.sampleDays), 2_000);
      const ideas = findUnderratedNiches(videos, channels, { max: Math.max(limit, 12), now }).map((niche) => ({
        topic: niche.term,
        topicKey: topicKey(niche.term),
        opportunity: niche.score,
        demand: niche.metrics.demand,
        competition: niche.metrics.competition,
        format: niche.metrics.format.best,
        medianViewsPerDay: niche.metrics.medianViewsPerDay,
        growth: niche.metrics.growth,
        videos: niche.metrics.videos,
        channels: niche.metrics.channels,
        smallChannelShare: niche.smallChannelViewShare,
        searchCount: 0,
        computedAt: now.toISOString(),
        reason: niche.reason,
      }));
      this.underratedCache = { at: now.getTime(), ideas };
      this.log.info("underrated niches mined", { sample: videos.length, found: ideas.length });
      return ideas.slice(0, limit);
    } catch (error) {
      this.log.warn("underrated niche mining failed", { error });
      return [];
    }
  }

  /**
   * Niches next to this one: other researched topics that share a word with it
   * or with its sub-niches, so someone can keep exploring sideways.
   */
  async relatedNiches(topic: string, report: NicheReport | null, limit = 6): Promise<NicheIdea[]> {
    const rows = await this.deps.niches.recentReports(120).catch(() => []);
    const key = topicKey(topic);
    const words = new Set([...tokenize(topic), ...(report?.subNiches ?? []).flatMap((sub) => tokenize(sub.term))]);
    if (words.size === 0) return [];

    return rows
      .flatMap((row) => {
        if (row.topic_key === key) return [];
        const idea = toIdea(row);
        if (!idea || idea.videos < 15) return [];
        const shared = tokenize(idea.topic).some((word) => words.has(word));
        return shared ? [idea] : [];
      })
      .sort((a, b) => b.opportunity - a.opportunity)
      .slice(0, limit);
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
