import { z } from "zod";
import { isAppError } from "@/lib/core/errors";
import type { ChannelRepository } from "@/lib/database/repositories/channels";
import type { SystemRepository } from "@/lib/database/repositories/system";
import type { ChannelService } from "@/lib/services/channel-service";
import type { StorageBudgetService } from "@/lib/services/storage-budget-service";
import { TRENDING_JOB_TYPE, type TrendingService } from "@/lib/services/trending-service";
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
  channelRepository: ChannelRepository;
  systemRepository: SystemRepository;
  /** Late-bound: the queue is created after the registry. */
  enqueue: (type: string, payload: unknown, options?: EnqueueOptions) => Promise<unknown>;
  config: {
    syncIntervalHours: number;
    syncMaxChannelsPerRun: number;
    snapshotDailyRetentionDays: number;
    snapshotRetentionDays: number;
  };
}

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
        description: "Scheduled: pick one breakout Shorts channel in each of today's 5 niches.",
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
        type: "maintenance.prune_snapshots",
        description: "Scheduled: thin snapshot history (daily -> weekly) and delete snapshots past retention.",
        payloadSchema: emptyPayload,
        maxAttempts: 2,
        handler: async () => {
          const deleted = await deps.systemRepository.pruneSnapshots(
            deps.config.snapshotDailyRetentionDays,
            deps.config.snapshotRetentionDays,
          );
          const status = await deps.storage.getStatus({ fresh: true });
          return { deleted, usedBytes: status.usedBytes };
        },
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
