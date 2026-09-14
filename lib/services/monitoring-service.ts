import { channelCheckInterval, computeMomentum, type MonitorPriority } from "@/lib/analytics/momentum";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { ChannelRepository } from "@/lib/database/repositories/channels";
import type { MonitoredVideo, VideoMonitoringUpdate, VideoRepository } from "@/lib/database/repositories/videos";
import type { EnqueueOptions } from "@/lib/jobs/queue";
import { isQuotaUnavailable } from "@/lib/youtube/quota-manager";
import type { YouTubeService } from "@/lib/youtube/service";
import type { ChannelService } from "./channel-service";

/**
 * Background intelligence: re-checks known videos and channels on a priority
 * schedule. Hot content (fast views/hour, accelerating, breaking out vs its
 * channel) is checked hourly; cooling content less often; stale content drops out.
 *
 * Quota: videos.list and channels.list batches of 50 = 1 unit per 50 items.
 */

export const MONITOR_VIDEOS_JOB_TYPE = "monitor.videos";
export const MONITOR_CHANNELS_JOB_TYPE = "monitor.channels";

const BATCH = 50;
/** Channels with a hot video get their uploads refreshed at most this often (to find sibling breakouts). */
const HOT_CHANNEL_RESYNC_HOURS = 24;

export interface MonitorVideosResult {
  checked: number;
  missing: number;
  hot: number;
  warm: number;
  retired: number;
  quotaUnits: number;
  stoppedBy: "done" | "quota" | "aborted";
}

export class MonitoringService {
  private readonly log: Logger;

  constructor(
    private readonly deps: {
      youtube: Pick<YouTubeService, "getVideos">;
      videos: Pick<VideoRepository, "listDueForMonitoring" | "applyMonitoring" | "insertSnapshots">;
      channels: Pick<ChannelRepository, "raiseMonitorPriority" | "listDueForMonitoring" | "scheduleMonitoring" | "medianShortViews">;
      channelService: Pick<ChannelService, "snapshotChannelStats">;
      enqueue: (type: string, payload: unknown, options?: EnqueueOptions) => Promise<unknown>;
    },
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger({ module: "services.monitoring" });
  }

  async monitorVideos(options: { maxVideos: number; signal?: AbortSignal }, now: Date = new Date()): Promise<MonitorVideosResult> {
    const due = await this.deps.videos.listDueForMonitoring(now, options.maxVideos);
    const result: MonitorVideosResult = { checked: 0, missing: 0, hot: 0, warm: 0, retired: 0, quotaUnits: 0, stoppedBy: "done" };
    if (due.length === 0) return result;

    const medians = await this.deps.channels.medianShortViews([...new Set(due.map((v) => v.channel_id))]);
    const hotChannels = new Map<string, MonitoredVideo>();
    const warmChannels = new Set<string>();

    for (let i = 0; i < due.length; i += BATCH) {
      if (options.signal?.aborted) {
        result.stoppedBy = "aborted";
        break;
      }
      const batch = due.slice(i, i + BATCH);
      let fetched;
      try {
        fetched = await this.deps.youtube.getVideos(batch.map((v) => v.youtube_video_id));
      } catch (error) {
        if (isQuotaUnavailable(error)) {
          // Keep what we've done; the rest stays due for the next run.
          result.stoppedBy = "quota";
          break;
        }
        throw error;
      }
      result.quotaUnits += 1;

      const byId = new Map(fetched.map((v) => [v.id, v]));
      const checkedAt = now;
      const updates: VideoMonitoringUpdate[] = [];
      const snapshots: { video_id: string; captured_at: string; view_count: number; like_count: number | null; comment_count: number | null }[] = [];

      for (const row of batch) {
        const remote = byId.get(row.youtube_video_id);
        if (!remote) {
          // Deleted or private: stop checking.
          result.missing += 1;
          updates.push({ id: row.id, view_count: null, like_count: null, comment_count: null, views_per_hour: null, view_acceleration: null, monitor_priority: 0, next_check_at: null, last_checked_at: checkedAt.toISOString() });
          continue;
        }
        const previousAt = row.last_checked_at ?? row.last_synced_at;
        const momentum = computeMomentum({
          views: remote.statistics.viewCount,
          checkedAt,
          publishedAt: row.published_at,
          previous: previousAt ? { views: row.view_count, checkedAt: previousAt, viewsPerHour: row.last_checked_at ? row.views_per_hour : null } : null,
          channelMedianViews: medians.get(row.channel_id) ?? null,
        });

        updates.push({
          id: row.id,
          view_count: remote.statistics.viewCount,
          like_count: remote.statistics.likeCount,
          comment_count: remote.statistics.commentCount,
          views_per_hour: momentum.viewsPerHour,
          view_acceleration: momentum.acceleration,
          monitor_priority: momentum.priority,
          next_check_at: momentum.nextCheckAt?.toISOString() ?? null,
          last_checked_at: checkedAt.toISOString(),
        });
        // History only for content still moving; cold checks just update totals.
        if (momentum.priority >= 1) {
          snapshots.push({
            video_id: row.id,
            captured_at: checkedAt.toISOString(),
            view_count: remote.statistics.viewCount,
            like_count: remote.statistics.likeCount,
            comment_count: remote.statistics.commentCount,
          });
        }

        result.checked += 1;
        if (momentum.nextCheckAt === null) result.retired += 1;
        if (momentum.priority === 3) {
          result.hot += 1;
          if (!hotChannels.has(row.channel_id)) hotChannels.set(row.channel_id, row);
        } else if (momentum.priority === 2) {
          result.warm += 1;
          warmChannels.add(row.channel_id);
        }
      }

      await this.deps.videos.applyMonitoring(updates);
      await this.deps.videos.insertSnapshots(snapshots);
    }

    // Rising videos pull their channels up the queue.
    await this.deps.channels.raiseMonitorPriority([...hotChannels.keys()], 3, now);
    await this.deps.channels.raiseMonitorPriority([...warmChannels].filter((id) => !hotChannels.has(id)), 2, now);

    this.log.info("video monitoring pass", { ...result });
    return result;
  }

  /** Snapshot stats for channels whose check is due; hot channels also get their latest uploads re-synced. */
  async monitorChannels(options: { maxChannels: number; signal?: AbortSignal }, now: Date = new Date()) {
    const due = await this.deps.channels.listDueForMonitoring(now, options.maxChannels);
    let checked = 0;
    let quotaUnits = 0;
    let resynced = 0;
    let stoppedBy: "done" | "quota" | "aborted" = "done";

    for (let i = 0; i < due.length; i += BATCH) {
      if (options.signal?.aborted) {
        stoppedBy = "aborted";
        break;
      }
      const batch = due.slice(i, i + BATCH);
      try {
        await this.deps.channelService.snapshotChannelStats(batch.map((c) => c.youtube_channel_id), now);
      } catch (error) {
        if (isQuotaUnavailable(error)) {
          stoppedBy = "quota";
          break;
        }
        throw error;
      }
      quotaUnits += 1;
      checked += batch.length;

      // Decay one level per check; the video monitor raises channels again while they're hot.
      const byPriority = new Map<MonitorPriority, string[]>();
      for (const channel of batch) {
        const priority = channel.monitor_priority as MonitorPriority;
        const list = byPriority.get(priority) ?? [];
        list.push(channel.id);
        byPriority.set(priority, list);

        const stale = !channel.last_synced_at || now.getTime() - Date.parse(channel.last_synced_at) > HOT_CHANNEL_RESYNC_HOURS * 3_600_000;
        if (priority === 3 && stale) {
          const day = now.toISOString().slice(0, 10);
          await this.deps.enqueue(
            "channel.refresh",
            { channelId: channel.youtube_channel_id, light: true },
            { idempotencyKey: `channel.refresh:${channel.youtube_channel_id}:${day}`, priority: 5 },
          );
          resynced += 1;
        }
      }
      for (const [priority, ids] of byPriority) {
        const next = priority <= 1 ? null : new Date(now.getTime() + channelCheckInterval(priority) * 3_600_000);
        await this.deps.channels.scheduleMonitoring(ids, Math.max(priority - 1, 0), next);
      }
    }

    const result = { checked, quotaUnits, resynced, stoppedBy };
    this.log.info("channel monitoring pass", result);
    return result;
  }
}
