import type { YouTubeChannel, YouTubeVideo } from "@/types/youtube";

/** Test fixtures that pass the default quality rules unless overridden. */

export function makeVideo(overrides: Partial<YouTubeVideo> & { views?: number; likes?: number | null; comments?: number | null } = {}): YouTubeVideo {
  const { views = 500_000, likes = 20_000, comments = 800, ...rest } = overrides;
  return {
    id: "video000001",
    channelId: "UCaaaaaaaaaaaaaaaaaaaaaa",
    channelTitle: "Channel",
    title: "How I cooked the perfect steak in 60 seconds",
    description: "",
    publishedAt: "2026-09-10T12:00:00Z",
    durationSeconds: 45,
    format: "short",
    formatSource: "shorts_playlist",
    categoryId: "26",
    tags: [],
    defaultLanguage: "en",
    defaultAudioLanguage: "en",
    thumbnailUrl: null,
    definition: "hd",
    hasCaptions: false,
    madeForKids: false,
    liveBroadcastContent: "none",
    topicCategories: [],
    statistics: { viewCount: views, likeCount: likes, commentCount: comments },
    ...rest,
  };
}

export function makeChannel(overrides: Partial<YouTubeChannel> & { subscribers?: number | null; videoCount?: number } = {}): YouTubeChannel {
  const { subscribers = 12_000, videoCount = 40, ...rest } = overrides;
  return {
    id: "UCaaaaaaaaaaaaaaaaaaaaaa",
    handle: "@channel",
    title: "Channel",
    description: "",
    customUrl: "@channel",
    country: "US",
    defaultLanguage: "en",
    publishedAt: "2025-01-01T00:00:00Z",
    thumbnailUrl: null,
    bannerUrl: null,
    uploadsPlaylistId: null,
    madeForKids: false,
    topicCategories: [],
    keywords: [],
    statistics: { subscriberCount: subscribers, viewCount: 5_000_000, videoCount, hiddenSubscriberCount: subscribers === null },
    ...rest,
  };
}
