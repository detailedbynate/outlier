/**
 * Normalized YouTube domain types. Raw API payloads are validated in
 * lib/youtube/schemas.ts and mapped to these shapes so the rest of the app
 * never depends on the YouTube Data API's response structure.
 */

import type { VideoFormat } from "./database";

export type { VideoFormat };

/** How a video's format was determined. Shorts are not flagged by the API, so this records confidence. */
export type FormatSource = "live_status" | "shorts_playlist" | "duration_heuristic" | "default";

export interface Page<T> {
  items: T[];
  nextPageToken: string | null;
  prevPageToken: string | null;
  totalResults: number | null;
}

export interface YouTubeChannel {
  id: string;
  handle: string | null;
  title: string;
  description: string;
  customUrl: string | null;
  country: string | null;
  defaultLanguage: string | null;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  bannerUrl: string | null;
  uploadsPlaylistId: string | null;
  madeForKids: boolean | null;
  topicCategories: string[];
  keywords: string[];
  statistics: {
    /** null when the channel hides its subscriber count. */
    subscriberCount: number | null;
    viewCount: number;
    videoCount: number;
    hiddenSubscriberCount: boolean;
  };
}

export interface YouTubeVideo {
  id: string;
  channelId: string;
  channelTitle: string;
  title: string;
  description: string;
  publishedAt: string;
  durationSeconds: number | null;
  format: VideoFormat;
  formatSource: FormatSource;
  categoryId: string | null;
  tags: string[];
  defaultLanguage: string | null;
  defaultAudioLanguage: string | null;
  thumbnailUrl: string | null;
  definition: string | null;
  hasCaptions: boolean | null;
  madeForKids: boolean | null;
  liveBroadcastContent: "none" | "live" | "upcoming" | null;
  topicCategories: string[];
  statistics: {
    viewCount: number;
    /** null when likes are hidden. */
    likeCount: number | null;
    /** null when comments are disabled. */
    commentCount: number | null;
  };
}

export interface YouTubePlaylist {
  id: string;
  channelId: string;
  channelTitle: string;
  title: string;
  description: string;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  itemCount: number;
  privacyStatus: string | null;
}

export interface YouTubePlaylistItem {
  videoId: string;
  playlistId: string;
  position: number | null;
  title: string;
  /** When the item was added to the playlist. */
  addedAt: string | null;
  /** When the video itself was published (absent for private/deleted videos). */
  videoPublishedAt: string | null;
}

export type SearchResultKind = "video" | "channel" | "playlist";

export interface YouTubeSearchResult {
  kind: SearchResultKind;
  id: string;
  channelId: string;
  channelTitle: string;
  title: string;
  description: string;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  liveBroadcastContent: string | null;
}

export interface YouTubeVideoCategory {
  id: string;
  title: string;
  assignable: boolean;
}

export type ChannelVideoFilter = "all" | "shorts" | "long_form";

export type ChannelIdentifier =
  | { type: "id"; value: string }
  | { type: "handle"; value: string }
  | { type: "username"; value: string }
  | { type: "custom"; value: string };
