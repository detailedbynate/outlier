import type {
  FormatSource,
  VideoFormat,
  YouTubeChannel,
  YouTubePlaylist,
  YouTubePlaylistItem,
  YouTubeSearchResult,
  YouTubeVideo,
  YouTubeVideoCategory,
} from "@/types/youtube";
import { parseChannelKeywords, parseCount, parseIsoDuration } from "./parse";
import type {
  RawChannel,
  RawPlaylist,
  RawPlaylistItem,
  RawSearchResult,
  RawThumbnails,
  RawVideo,
  RawVideoCategory,
} from "./schemas";

/** Shorts can be up to 3 minutes. Used only when the Shorts playlist isn't available. */
export const SHORTS_MAX_DURATION_SECONDS = 180;

export function bestThumbnail(thumbnails: RawThumbnails | undefined): string | null {
  if (!thumbnails) return null;
  return (
    thumbnails.maxres?.url ??
    thumbnails.standard?.url ??
    thumbnails.high?.url ??
    thumbnails.medium?.url ??
    thumbnails.default?.url ??
    null
  );
}

export function mapChannel(raw: RawChannel): YouTubeChannel {
  const snippet = raw.snippet;
  const stats = raw.statistics;
  const hidden = stats?.hiddenSubscriberCount ?? false;
  const customUrl = snippet?.customUrl ?? null;

  return {
    id: raw.id,
    handle: customUrl?.startsWith("@") ? customUrl : null,
    title: snippet?.title ?? "",
    description: snippet?.description ?? "",
    customUrl,
    country: snippet?.country ?? raw.brandingSettings?.channel?.country ?? null,
    defaultLanguage: snippet?.defaultLanguage ?? null,
    publishedAt: snippet?.publishedAt ?? null,
    thumbnailUrl: bestThumbnail(snippet?.thumbnails),
    bannerUrl: raw.brandingSettings?.image?.bannerExternalUrl ?? null,
    uploadsPlaylistId: raw.contentDetails?.relatedPlaylists?.uploads ?? null,
    madeForKids: raw.status?.madeForKids ?? null,
    topicCategories: raw.topicDetails?.topicCategories ?? [],
    keywords: parseChannelKeywords(raw.brandingSettings?.channel?.keywords),
    statistics: {
      subscriberCount: hidden ? null : parseCount(stats?.subscriberCount),
      viewCount: parseCount(stats?.viewCount) ?? 0,
      videoCount: parseCount(stats?.videoCount) ?? 0,
      hiddenSubscriberCount: hidden,
    },
  };
}

export interface VideoFormatHints {
  /** Video ids known to be Shorts (from the channel's UUSH playlist). */
  knownShortIds?: ReadonlySet<string>;
  /** Video ids known NOT to be Shorts (from the channel's UULF playlist). */
  knownLongFormIds?: ReadonlySet<string>;
}

export function classifyVideoFormat(
  raw: RawVideo,
  durationSeconds: number | null,
  hints: VideoFormatHints = {},
): { format: VideoFormat; formatSource: FormatSource } {
  const live = raw.snippet?.liveBroadcastContent;
  if (live === "live") return { format: "live", formatSource: "live_status" };
  if (live === "upcoming") return { format: "upcoming", formatSource: "live_status" };
  if (raw.liveStreamingDetails?.actualStartTime) return { format: "live", formatSource: "live_status" };
  if (hints.knownShortIds?.has(raw.id)) return { format: "short", formatSource: "shorts_playlist" };
  if (hints.knownLongFormIds?.has(raw.id)) return { format: "long_form", formatSource: "shorts_playlist" };
  if (durationSeconds !== null && durationSeconds > 0 && durationSeconds <= SHORTS_MAX_DURATION_SECONDS) {
    return { format: "short", formatSource: "duration_heuristic" };
  }
  return { format: "long_form", formatSource: durationSeconds === null ? "default" : "duration_heuristic" };
}

export function mapVideo(raw: RawVideo, hints: VideoFormatHints = {}): YouTubeVideo {
  const snippet = raw.snippet;
  const durationSeconds = parseIsoDuration(raw.contentDetails?.duration);
  const { format, formatSource } = classifyVideoFormat(raw, durationSeconds, hints);
  const live = snippet?.liveBroadcastContent;

  return {
    id: raw.id,
    channelId: snippet?.channelId ?? "",
    channelTitle: snippet?.channelTitle ?? "",
    title: snippet?.title ?? "",
    description: snippet?.description ?? "",
    publishedAt: snippet?.publishedAt ?? "",
    durationSeconds,
    format,
    formatSource,
    categoryId: snippet?.categoryId ?? null,
    tags: snippet?.tags ?? [],
    defaultLanguage: snippet?.defaultLanguage ?? null,
    defaultAudioLanguage: snippet?.defaultAudioLanguage ?? null,
    thumbnailUrl: bestThumbnail(snippet?.thumbnails),
    definition: raw.contentDetails?.definition ?? null,
    hasCaptions: raw.contentDetails?.caption === undefined ? null : raw.contentDetails.caption === "true",
    madeForKids: raw.status?.madeForKids ?? null,
    liveBroadcastContent: live === "none" || live === "live" || live === "upcoming" ? live : null,
    topicCategories: raw.topicDetails?.topicCategories ?? [],
    statistics: {
      viewCount: parseCount(raw.statistics?.viewCount) ?? 0,
      likeCount: parseCount(raw.statistics?.likeCount),
      commentCount: parseCount(raw.statistics?.commentCount),
    },
  };
}

export function mapPlaylist(raw: RawPlaylist): YouTubePlaylist {
  return {
    id: raw.id,
    channelId: raw.snippet?.channelId ?? "",
    channelTitle: raw.snippet?.channelTitle ?? "",
    title: raw.snippet?.title ?? "",
    description: raw.snippet?.description ?? "",
    publishedAt: raw.snippet?.publishedAt ?? null,
    thumbnailUrl: bestThumbnail(raw.snippet?.thumbnails),
    itemCount: raw.contentDetails?.itemCount ?? 0,
    privacyStatus: raw.status?.privacyStatus ?? null,
  };
}

export function mapPlaylistItem(raw: RawPlaylistItem): YouTubePlaylistItem | null {
  const videoId = raw.contentDetails?.videoId ?? raw.snippet?.resourceId?.videoId;
  if (!videoId) return null;
  return {
    videoId,
    playlistId: raw.snippet?.playlistId ?? "",
    position: raw.snippet?.position ?? null,
    title: raw.snippet?.title ?? "",
    addedAt: raw.snippet?.publishedAt ?? null,
    videoPublishedAt: raw.contentDetails?.videoPublishedAt ?? null,
  };
}

export function mapSearchResult(raw: RawSearchResult): YouTubeSearchResult | null {
  const { kind, videoId, channelId, playlistId } = raw.id;
  const snippet = raw.snippet;
  const base = {
    channelId: snippet?.channelId ?? channelId ?? "",
    channelTitle: snippet?.channelTitle ?? "",
    title: snippet?.title ?? "",
    description: snippet?.description ?? "",
    publishedAt: snippet?.publishedAt ?? null,
    thumbnailUrl: bestThumbnail(snippet?.thumbnails),
    liveBroadcastContent: snippet?.liveBroadcastContent ?? null,
  };
  if (kind === "youtube#video" && videoId) return { kind: "video", id: videoId, ...base };
  if (kind === "youtube#channel" && channelId) return { kind: "channel", id: channelId, ...base };
  if (kind === "youtube#playlist" && playlistId) return { kind: "playlist", id: playlistId, ...base };
  return null;
}

export function mapVideoCategory(raw: RawVideoCategory): YouTubeVideoCategory {
  return { id: raw.id, title: raw.snippet?.title ?? "", assignable: raw.snippet?.assignable ?? false };
}
