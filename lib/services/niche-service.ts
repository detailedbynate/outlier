import { z } from "zod";
import type { TextProvider } from "@/lib/ai/types";
import { AppError, ValidationError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";
import { channelToRow, type ChannelRepository } from "@/lib/database/repositories/channels";
import type { NicheRepository } from "@/lib/database/repositories/niches";
import type { UsageRepository } from "@/lib/database/repositories/usage";
import { videoToRow, type VideoRepository } from "@/lib/database/repositories/videos";
import type { EnqueueOptions } from "@/lib/jobs/queue";
import { buildNicheReport, tokenize, topicKey, type Level, type NicheReport } from "@/lib/niches/analysis";
import { canonicalNiche } from "@/lib/niches/naming";
import { findUnderratedNiches, underratedWindow, type NicheCreator, type NicheExample } from "@/lib/niches/underrated";
import { isQuotaUnavailable } from "@/lib/youtube/quota-manager";
import type { YouTubeService } from "@/lib/youtube/service";
import type { Json } from "@/types/database";
import type { YouTubeVideo } from "@/types/youtube";
import type { CreditsService } from "./credits-service";
import type { StorageBudgetService } from "./storage-budget-service";

/**
 * Niche Finder, database-first:
 *
 *   report cache (shared, 6h) → stored videos/channels → YouTube only when the
 *   stored sample is too thin, at most once per topic per day across all users
 *   (one search.list + one batched channels.list ≈ 102 units) → store → analyze.
 *
 * When nothing at all is stored for a topic, the AI turns it into a few better
 * YouTube searches (≈ 101 units each) and related words, and the related words
 * are saved with the topic so the channels found keep matching it later.
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
  /** YouTube searches for a topic with no stored data at all (AI-planned). */
  discoverySearches: number;
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
  discoverySearches: 3,
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
  /** Uploads that show what's working, from smaller channels. */
  examples: NicheExample[];
  creators: NicheCreator[];
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
export function reasonFor(metrics: NicheReport["overall"]): string {
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
    examples: (overall.breakouts ?? []).slice(0, 3).map((b) => ({
      youtubeVideoId: b.youtube_video_id,
      title: b.title,
      channelTitle: b.channel_title,
      views: b.view_count,
      subscribers: null,
      publishedAt: b.published_at,
    })),
    creators: (overall.topChannels ?? [])
      .filter((c) => c.subscriber_count === null || c.subscriber_count < 250_000)
      .slice(0, 4)
      .map((c) => ({
        youtubeChannelId: c.youtube_channel_id,
        title: c.title,
        thumbnailUrl: c.thumbnail_url,
        subscribers: c.subscriber_count,
        avgViews: c.videos > 0 ? Math.round(c.views / c.videos) : 0,
      })),
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
      /** Plans searches for topics with no stored data. Without it, the topic is searched as typed. */
      ai?: Pick<TextProvider, "generateObject"> | null;
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
        examples: niche.examples,
        creators: niche.creators,
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

  /**
   * Topics to suggest on the Niche Finder. These come from what people searched
   * for, so only searches that resolve to a niche the dictionary knows are shown:
   * whatever someone typed into the box is never offered back to everybody, and
   * the chips stay useful rather than being a search log.
   */
  async popularTopics(limit = 8): Promise<{ topic: string; search_count: number }[]> {
    // Ask for extra rows: most searches won't be recognizable niches.
    const rows = await this.deps.niches.popularTopics(limit * 6).catch(() => []);
    const seen = new Set<string>();
    const suggestions: { topic: string; search_count: number }[] = [];
    for (const row of rows) {
      const name = canonicalNiche(row.topic);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      suggestions.push({ ...row, topic: name });
      if (suggestions.length >= limit) break;
    }
    return suggestions;
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
    let related = cached?.search_terms ?? [];
    let sample = await this.deps.niches.topicSample(topic, since, undefined, related);
    let source: NicheSource = "database";
    let unitsSpent = 0;
    let notice: string | null = null;
    let stale = false;
    let youtubeRefreshedAt = cached?.youtube_refreshed_at ?? null;

    const thin = sample.videos.length < this.config.minVideos || sample.channels.size < this.config.minChannels;
    const refreshedRecently = youtubeRefreshedAt !== null && now.getTime() - Date.parse(youtubeRefreshedAt) < this.config.youtubeRefreshMs;

    // 3. YouTube, only when the stored sample is too thin.
    if (thin && !refreshedRecently) {
      const outcome = await this.tryRefreshFromYouTube(topic, key, userId, now, sample.videos.length === 0);
      if (outcome.status === "refreshed") {
        source = "youtube";
        unitsSpent = outcome.units;
        youtubeRefreshedAt = now.toISOString();
        related = [...new Set([...related, ...outcome.related])].slice(0, 4);
        sample = await this.deps.niches.topicSample(topic, since, undefined, related);
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
      related,
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
    empty: boolean,
  ): Promise<{ status: "refreshed"; units: number; related: string[] } | { status: "skipped" | "quota"; notice: string }> {
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
      // Nothing stored at all: let the AI pick better searches than the raw words.
      const plan = empty ? await this.planDiscovery(topic) : { queries: [topic], related: [] };
      // Each search (100 units) is hydrated with batched video stats (1 unit); channels follow in batches of 50 (1 unit each).
      const found = new Map<string, YouTubeVideo>();
      for (const q of plan.queries) {
        const page = await this.deps.youtube.searchVideos({
          q,
          order: "viewCount",
          publishedAfter: new Date(now.getTime() - 30 * 86_400_000).toISOString(),
          relevanceLanguage: this.config.language,
          regionCode: this.config.regionCode,
          maxResults: 50,
        });
        for (const video of page.items) found.set(video.id, video);
      }
      const results = { items: [...found.values()] };
      const channelIds = [...new Set(results.items.map((v) => v.channelId).filter(Boolean))];
      const channels = channelIds.length ? await this.deps.youtube.getChannels(channelIds) : [];
      const units = plan.queries.length * 101 + Math.ceil(channelIds.length / 50);

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
        metadata: { units, videos: results.items.length, channels: channels.length, queries: plan.queries } as Json,
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
      return { status: "refreshed", units, related: plan.related };
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

  /**
   * YouTube searches and related words for a topic we know nothing about. Falls
   * back to searching the topic as typed when no AI is set up or it fails.
   */
  private async planDiscovery(topic: string): Promise<{ queries: string[]; related: string[] }> {
    const fallback = { queries: [topic], related: [] };
    if (!this.deps.ai) return fallback;
    try {
      const { object } = await this.deps.ai.generateObject({
        system: DISCOVERY_PROMPT,
        messages: [{ role: "user", content: `Topic: ${topic}` }],
        schema: discoveryPlanSchema,
        schemaName: "niche_discovery_plan",
        maxOutputTokens: 400,
        effort: "low",
      });
      const tidy = (values: string[]) =>
        [...new Set(values.map((v) => v.replace(/\s+/g, " ").trim().toLowerCase()).filter((v) => v.length >= 2 && v.length <= 60))];
      // The topic as typed always goes first; the AI only adds to it.
      const queries = tidy([topic, ...object.queries]).slice(0, this.config.discoverySearches);
      const related = tidy(object.related).filter((word) => topicKey(word) !== topicKey(topic)).slice(0, 4);
      return { queries, related };
    } catch (error) {
      this.log.warn("niche discovery planning failed, searching the topic as typed", { topic, error });
      return fallback;
    }
  }

  private async saveSearch(
    key: string,
    topic: string,
    cached: Awaited<ReturnType<NicheRepository["getReport"]>>,
    now: Date,
    computed: {
      report: NicheReport;
      source: "database" | "youtube";
      videos: number;
      channels: number;
      units: number;
      youtubeRefreshedAt: string | null;
      related: string[];
    } | null,
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
              search_terms: computed.related,
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

const discoveryPlanSchema = z.object({
  queries: z.array(z.string()),
  related: z.array(z.string()),
});

const DISCOVERY_PROMPT = `You help Outlier, a YouTube research tool, find channels for a niche it has no data on yet.

Given a topic someone typed, return:
- queries: two or three YouTube searches that would surface videos from channels that make this kind of content. Use the words creators put in their titles rather than restating the topic. Add "shorts" only if the topic is usually short-form.
- related: up to four short words or phrases (one to three words) that mean the same niche and would appear in those channels' video titles: other names, key people, common terms. Skip broad words that would match unrelated channels ("tips", "video", "life").

Example for "stoicism": queries ["stoic philosophy", "marcus aurelius lessons"], related ["stoic", "marcus aurelius", "seneca"].`;

function isReport(value: unknown): value is NicheReport {
  // Reports from before monthly views and viral channels existed are rebuilt rather than shown half-empty.
  return typeof value === "object" && value !== null && "overall" in value && "subNiches" in value && typeof value.overall === "object" && value.overall !== null && "monthlyViews" in value.overall;
}
