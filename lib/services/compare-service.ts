import { computeChannelStats, type ChannelStats } from "@/lib/analytics/compare";
import { isAppError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { ChannelRepository } from "@/lib/database/repositories/channels";
import type { VideoRepository } from "@/lib/database/repositories/videos";
import { parseChannelIdentifier } from "@/lib/youtube/parse";
import { isQuotaUnavailable } from "@/lib/youtube/quota-manager";
import type { ChannelRow } from "@/types/database";
import type { ChannelService } from "./channel-service";

/**
 * "You vs competitors" from public YouTube data. Channels already in the catalog
 * and synced recently cost nothing; others are synced and tracked (~3-5 quota units).
 */

export const MAX_COMPETITORS_COMPARED = 5;
/** Re-sync channels whose data is older than this before comparing. */
export const FRESH_MS = 12 * 3_600_000;
const RECENT_UPLOADS = 30;

export interface ComparedChannel {
  identifier: string;
  channel: ChannelRow;
  stats: ChannelStats;
}

export interface CompareFailure {
  identifier: string;
  error: string;
}

export interface CompareResult {
  you: ComparedChannel | null;
  competitors: ComparedChannel[];
  failures: CompareFailure[];
}

export class CompareService {
  private readonly log: Logger;

  constructor(
    private readonly deps: {
      channels: Pick<ChannelRepository, "findByYouTubeId" | "findByHandle" | "listSnapshots" | "setTracked">;
      videos: Pick<VideoRepository, "recentVideos">;
      channelService: Pick<ChannelService, "refreshChannel">;
    },
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger({ module: "services.compare" });
  }

  async compare(you: string | null, competitors: readonly string[], now: Date = new Date()): Promise<CompareResult> {
    const wanted = [...new Set(competitors.map((c) => c.trim()).filter(Boolean))].slice(0, MAX_COMPETITORS_COMPARED);
    const failures: CompareFailure[] = [];
    const load = async (identifier: string) => {
      try {
        return await this.loadChannel(identifier, now);
      } catch (error) {
        this.log.warn("compare channel failed", { identifier, error });
        failures.push({ identifier, error: isAppError(error) && error.expose ? error.message : "Couldn't load this channel." });
        return null;
      }
    };

    // Load everything in parallel: each channel needs a few YouTube calls, so a
    // sequential loop made a full refresh take 15-20 seconds.
    const [youResult, ...results] = await Promise.all([you?.trim() ? load(you.trim()) : Promise.resolve(null), ...wanted.map(load)]);
    const loaded: ComparedChannel[] = [];
    for (const result of results) {
      // Skip duplicates of "you" or of each other (e.g. a URL and a handle for the same channel).
      if (result && result.channel.id !== youResult?.channel.id && !loaded.some((c) => c.channel.id === result.channel.id)) {
        loaded.push(result);
      }
    }
    return { you: youResult, competitors: loaded, failures };
  }

  private async loadChannel(identifier: string, now: Date): Promise<ComparedChannel> {
    const parsed = parseChannelIdentifier(identifier);
    let channel =
      parsed.type === "id"
        ? await this.deps.channels.findByYouTubeId(parsed.value)
        : parsed.type === "handle"
          ? await this.deps.channels.findByHandle(parsed.value)
          : null;

    const stale = !channel?.last_synced_at || now.getTime() - Date.parse(channel.last_synced_at) > FRESH_MS;
    if (!channel || stale) {
      try {
        // Tracking keeps daily snapshots coming, so subscriber growth builds up over time.
        channel = (await this.deps.channelService.refreshChannel(channel?.youtube_channel_id ?? identifier, { track: true }, now)).channel;
      } catch (error) {
        // Out of quota: compare with the data we already have, and let the daily refresh catch up.
        if (!channel || !isQuotaUnavailable(error)) throw error;
        this.log.info("compare using stored data (quota unavailable)", { identifier });
        if (!channel.tracked) await this.deps.channels.setTracked(channel.id, true);
      }
    } else if (!channel.tracked) {
      await this.deps.channels.setTracked(channel.id, true);
    }

    const [shorts, longs, snapshots] = await Promise.all([
      this.deps.videos.recentVideos(channel.id, "short", RECENT_UPLOADS),
      this.deps.videos.recentVideos(channel.id, "long_form", RECENT_UPLOADS),
      this.deps.channels.listSnapshots(channel.id, new Date(now.getTime() - 35 * 86_400_000)),
    ]);

    const stats = computeChannelStats(
      {
        subscriberCount: channel.hidden_subscriber_count ? null : channel.subscriber_count,
        viewCount: channel.view_count,
        videoCount: channel.video_count,
        createdAt: channel.published_at,
        videos: [...shorts, ...longs],
        subscriberHistory: snapshots
          .filter((s) => s.subscriber_count !== null)
          .map((s) => ({ capturedAt: s.captured_at, value: s.subscriber_count! })),
      },
      now,
    );
    return { identifier, channel, stats };
  }
}
