import { z } from "zod";
import { isAppError } from "@/lib/core/errors";
import type { ChannelRepository } from "@/lib/database/repositories/channels";
import type { RateLimitRepository } from "@/lib/database/repositories/rate-limits";
import type { SystemRepository } from "@/lib/database/repositories/system";
import type { ChannelService } from "@/lib/services/channel-service";
import type { LibraryGrowthService } from "@/lib/services/library-growth-service";
import { MONITOR_CHANNELS_JOB_TYPE, MONITOR_VIDEOS_JOB_TYPE, type MonitoringService } from "@/lib/services/monitoring-service";
import type { NicheLabelingService } from "@/lib/services/niche-labeling-service";
import type { StorageBudgetService } from "@/lib/services/storage-budget-service";
import { TRENDING_JOB_TYPE, TRENDING_REFRESH_JOB_TYPE, type TrendingService } from "@/lib/services/trending-service";
import type { VideoService } from "@/lib/services/video-service";
import { CHANNEL_ID_PATTERN } from "@/lib/youtube/parse";
import type { EnqueueOptions } from "./queue";
import { JobRegistry } from "./registry";
import { defineJob } from "./types";

export interface JobDependencies {
  channels: ChannelService;
  videos: VideoService;
  storage: StorageBudgetService;
  trending: TrendingService;
  monitoring: MonitoringService;
  nicheLabeling: NicheLabelingService;
  libraryGrowth: LibraryGrowthService;
  /** Housekeeping for the YouTube response cache and quota ledger. */
  youtubeHousekeeping: { pruneCache: () => Promise<void>; pruneQuotaHistory: () => Promise<void> };
  channelRepository: ChannelRepository;
  systemRepository: SystemRepository;
  rateLimitRepository: Pick<RateLimitRepository, "deleteOlderThan">;
  /** Late-bound: the queue is created after the registry. */
  enqueue: (type: string, payload: unknown, options?: EnqueueOptions) => Promise<unknown>;
  config: {
    syncIntervalHours: number;
    syncMaxChannelsPerRun: number;
    snapshotDailyRetentionDays: number;
    snapshotRetentionDays: number;
    statsSnapshotMaxChannels: number;
    monitorMaxVideosPerRun: number;
    monitorMaxChannelsPerRun: number;
    nicheLabelMaxPerRun: number;
  };
}

export const NICHE_LABEL_JOB_TYPE = "niches.label_channels";
export const LIBRARY_GROWTH_JOB_TYPE = "library.grow";

/** Payload schemas are exported so API routes and MCP tools can reuse them. */
export const channelSyncPayload = z.object({ identifier: z.string().trim().min(1).max(500) });

export const channelSyncVideosPayload = z.object({
  channelId: z.string().regex(CHANNEL_ID_PATTERN, "Expected a YouTube channel id (UC...)"),
  maxPages: z.number().int().min(1).max(20).default(1),
  filter: z.enum(["all", "shorts", "long_form"]).default("all"),
});

export const channelRefreshPayload = z.object({
  channelId: z.string().regex(CHANNEL_ID_PATTERN, "Expected a YouTube channel id (UC...)"),
  /** Discovered channels: fewer uploads, no descriptions. Ignored for tracked channels. */
  light: z.boolean().default(false),
});

export const videoAnalyzePayload = z.object({ video: z.string().trim().min(1).max(500) });

const emptyPayload = z.object({}).default({});

/** Channels found by research tools refresh weekly instead of daily. */
const DISCOVERED_REFRESH_DAYS = 7;

/** Return a "skipped" result instead of failing when storage is full — retrying won't help until data is pruned. */
async function skipIfOverBudget<T>(run: () => Promise<T>): Promise<T | { skipped: "storage_budget"; message: string }> {
  try {
    return await run();
  } catch (error) {
    if (isAppError(error) && error.code === "STORAGE_BUDGET_EXCEEDED") return { skipped: "storage_budget", message: error.message };
    throw error;
  }
}

export function createJobRegistry(deps: JobDependencies): JobRegistry {
  return new JobRegistry()
    .register(
      defineJob({
        type: "channel.sync",
        description: "Fetch a channel from YouTube, upsert it, and record a statistics snapshot.",
        payloadSchema: channelSyncPayload,
        handler: async ({ identifier }) => {
          const { channel, snapshotCreated } = await deps.channels.syncChannel(identifier);
          return { channelId: channel.id, youtubeChannelId: channel.youtube_channel_id, snapshotCreated };
        },
      }),
    )
    .register(
      defineJob({
        type: "channel.sync_videos",
        description: "Ingest a channel's recent uploads, snapshot their stats, and recompute performance metrics.",
        payloadSchema: channelSyncVideosPayload,
        handler: async ({ channelId, maxPages, filter }) => {
          const result = await deps.channels.syncChannelVideos(channelId, { maxPages, filter });
          return { ...result };
        },
      }),
    )
    .register(
      defineJob({
        type: "channel.refresh",
        description: "Refresh a tracked channel: stats snapshot, latest uploads, performance metrics.",
        payloadSchema: channelRefreshPayload,
        handler: ({ channelId, light }) =>
          skipIfOverBudget(async () => {
            const { channel, videosSynced } = await deps.channels.refreshChannel(channelId, { light });
            return { youtubeChannelId: channel.youtube_channel_id, videosSynced };
          }),
      }),
    )
    .register(
      defineJob({
        type: "catalog.refresh",
        description: "Scheduled: enqueue refreshes for the stalest tracked channels, within the storage budget.",
        payloadSchema: emptyPayload,
        maxAttempts: 1,
        handler: async () => {
          const status = await deps.storage.getStatus({ fresh: true });
          if (status.level === "over_budget") {
            return { skipped: "storage_budget", usedBytes: status.usedBytes, budgetBytes: status.budgetBytes };
          }
          // Slightly shorter than the interval so a channel synced at 09:05 yesterday is due at 09:00 today.
          const trackedBefore = new Date(Date.now() - deps.config.syncIntervalHours * 0.9 * 3_600_000);
          const discoveredBefore = new Date(Date.now() - DISCOVERED_REFRESH_DAYS * 86_400_000);
          const channels = await deps.channelRepository.listDueForRefresh(trackedBefore, discoveredBefore, deps.config.syncMaxChannelsPerRun);
          const day = new Date().toISOString().slice(0, 10);
          for (const channel of channels) {
            await deps.enqueue(
              "channel.refresh",
              { channelId: channel.youtube_channel_id, light: !channel.tracked },
              { idempotencyKey: `channel.refresh:${channel.youtube_channel_id}:${day}`, priority: -10 },
            );
          }
          return { enqueued: channels.length, storageBudgetUsed: Number(status.budgetUsed.toFixed(3)) };
        },
      }),
    )
    .register(
      defineJob({
        type: TRENDING_JOB_TYPE,
        description: "Scheduled daily: pick one breakout Short from a small channel in each of 5 niches.",
        payloadSchema: emptyPayload,
        maxAttempts: 2,
        handler: async () => {
          const status = await deps.storage.getStatus({ fresh: true });
          if (status.level === "over_budget") return { skipped: "storage_budget" };
          return { ...(await deps.trending.computeDailyPicks()) };
        },
      }),
    )
    .register(
      defineJob({
        type: TRENDING_REFRESH_JOB_TYPE,
        description: "Scheduled hourly: refresh views and subscribers for today's trending picks (~2 quota units).",
        payloadSchema: emptyPayload,
        maxAttempts: 1,
        freshData: true,
        handler: async () => ({ ...(await deps.trending.refreshStats()) }),
      }),
    )
    .register(
      defineJob({
        type: "catalog.detect_languages",
        description: "Detect content language for channels not checked yet, from stored uploads (no YouTube quota).",
        payloadSchema: emptyPayload,
        maxAttempts: 1,
        handler: async (_payload, { signal }) => {
          let checked = 0;
          while (!signal.aborted && checked < 2_000) {
            const batch = await deps.channelRepository.listLanguageUnchecked(100);
            if (batch.length === 0) break;
            for (const channel of batch) await deps.channels.detectLanguage(channel.id);
            checked += batch.length;
          }
          return { checked };
        },
      }),
    )
    .register(
      defineJob({
        type: "catalog.snapshot_stats",
        description: "Scheduled: snapshot subscriber/view counts for every catalog channel (24h/48h growth).",
        payloadSchema: emptyPayload,
        maxAttempts: 2,
        freshData: true,
        handler: (_payload, { signal }) =>
          skipIfOverBudget(async () => {
            let after: string | null = null;
            let updated = 0;
            let batches = 0;
            while (updated < deps.config.statsSnapshotMaxChannels && !signal.aborted) {
              const ids = await deps.channelRepository.youtubeIdsPage(after, 50);
              if (ids.length === 0) break;
              updated += (await deps.channels.snapshotChannelStats(ids)).updated;
              after = ids.at(-1)!;
              batches += 1;
              if (ids.length < 50) break;
            }
            return { updated, quotaUnits: batches };
          }),
      }),
    )
    .register(
      defineJob({
        type: "maintenance.prune_snapshots",
        description: "Scheduled: thin snapshot history (daily -> weekly) and delete snapshots past retention.",
        payloadSchema: emptyPayload,
        maxAttempts: 2,
        handler: async () => {
          const deleted = await deps.systemRepository.pruneSnapshots(
            deps.config.snapshotDailyRetentionDays,
            deps.config.snapshotRetentionDays,
          );
          // Rate-limit windows older than a day are never read again.
          await deps.rateLimitRepository.deleteOlderThan(new Date(Date.now() - 86_400_000));
          await deps.youtubeHousekeeping.pruneCache();
          await deps.youtubeHousekeeping.pruneQuotaHistory();
          const status = await deps.storage.getStatus({ fresh: true });
          return { deleted, usedBytes: status.usedBytes };
        },
      }),
    )
    .register(
      defineJob({
        type: MONITOR_VIDEOS_JOB_TYPE,
        description: "Scheduled: re-check due videos in batches of 50 (views/hour, acceleration, next check by priority).",
        payloadSchema: emptyPayload,
        maxAttempts: 1,
        freshData: true,
        handler: (_payload, { signal }) =>
          skipIfOverBudget(async () => ({ ...(await deps.monitoring.monitorVideos({ maxVideos: deps.config.monitorMaxVideosPerRun, signal })) })),
      }),
    )
    .register(
      defineJob({
        type: MONITOR_CHANNELS_JOB_TYPE,
        description: "Scheduled: snapshot stats for channels due by priority; re-sync uploads of channels with hot videos.",
        payloadSchema: emptyPayload,
        maxAttempts: 1,
        freshData: true,
        handler: (_payload, { signal }) =>
          skipIfOverBudget(async () => ({ ...(await deps.monitoring.monitorChannels({ maxChannels: deps.config.monitorMaxChannelsPerRun, signal })) })),
      }),
    )
    .register(
      defineJob({
        type: NICHE_LABEL_JOB_TYPE,
        description: "Scheduled: label channels that were never labeled with a category, game or topic, and sub-niches (AI, no YouTube quota).",
        payloadSchema: emptyPayload,
        maxAttempts: 1,
        handler: async (_payload, { signal }) => ({ ...(await deps.nicheLabeling.labelPending({ maxChannels: deps.config.nicheLabelMaxPerRun, signal })) }),
      }),
    )
    .register(
      defineJob({
        type: LIBRARY_GROWTH_JOB_TYPE,
        description: "Scheduled: discover Shorts channels for seed niches the library is thinnest on (background quota lane).",
        payloadSchema: emptyPayload,
        maxAttempts: 1,
        handler: (_payload, { signal }) => skipIfOverBudget(async () => ({ ...(await deps.libraryGrowth.growOnce({ signal })) })),
      }),
    )
    .register(
      defineJob({
        type: "video.analyze",
        description: "Score a video against its channel's recent uploads.",
        payloadSchema: videoAnalyzePayload,
        handler: async ({ video }) => {
          const analysis = await deps.videos.analyzeVideo(video);
          return {
            videoId: analysis.video.id,
            channelId: analysis.channel.id,
            baselineSampleSize: analysis.baselineSampleSize,
            metrics: { ...analysis.metrics },
            analyzedAt: analysis.analyzedAt,
          };
        },
      }),
    );
}
