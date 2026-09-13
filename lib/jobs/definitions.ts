import { z } from "zod";
import type { ChannelService } from "@/lib/services/channel-service";
import type { VideoService } from "@/lib/services/video-service";
import { CHANNEL_ID_PATTERN } from "@/lib/youtube/parse";
import { JobRegistry } from "./registry";
import { defineJob } from "./types";

export interface JobDependencies {
  channels: ChannelService;
  videos: VideoService;
}

/** Payload schemas are exported so API routes and MCP tools can reuse them. */
export const channelSyncPayload = z.object({ identifier: z.string().trim().min(1).max(500) });

export const channelSyncVideosPayload = z.object({
  channelId: z.string().regex(CHANNEL_ID_PATTERN, "Expected a YouTube channel id (UC...)"),
  maxPages: z.number().int().min(1).max(20).default(1),
  filter: z.enum(["all", "shorts", "long_form"]).default("all"),
});

export const videoAnalyzePayload = z.object({ video: z.string().trim().min(1).max(500) });

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
