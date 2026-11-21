import type { VideoFeedRow } from "@/types/database";
import type { WatchItem } from "./watch-grid";

/** What the in-page player needs to know about each video in a grid. */
export const watchItems = (videos: readonly VideoFeedRow[]): WatchItem[] =>
  videos.map((v) => ({
    id: v.youtube_video_id,
    title: v.title,
    channel: v.channel_title,
    channelId: v.youtube_channel_id,
    short: v.format === "short",
    score: v.outlier_score,
    views: v.view_count,
    perDay: v.views_per_day,
    published: v.published_at,
  }));
