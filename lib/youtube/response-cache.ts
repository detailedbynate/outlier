import type { YouTubeEndpoint } from "./client";

/**
 * Shared cache for raw YouTube API responses, keyed by endpoint + parameters
 * (never the API key). Any user's identical request reuses a recent response.
 */

export interface CachedResponse {
  body: unknown;
  fetchedAt: Date;
  expiresAt: Date;
}

export interface ResponseCacheStore {
  get(key: string): Promise<CachedResponse | null>;
  set(key: string, endpoint: YouTubeEndpoint, body: unknown, expiresAt: Date): Promise<void>;
}

/** Default freshness per endpoint. Statistics go stale fast; metadata and searches don't. */
export const DEFAULT_CACHE_TTL_SECONDS: Record<YouTubeEndpoint, number> = {
  channels: 30 * 60,
  videos: 15 * 60,
  search: 6 * 3600,
  playlists: 6 * 3600,
  playlistItems: 30 * 60,
  videoCategories: 7 * 86_400,
  // Featured channels rarely change.
  channelSections: 7 * 86_400,
};

/** Responses larger than this aren't cached, to protect database storage. */
export const MAX_CACHED_BYTES = 256_000;
/** Stale responses may still be served when quota is unavailable, up to this age. */
export const MAX_STALE_SECONDS = 2 * 86_400;

type ParamValue = string | number | boolean | readonly string[] | null | undefined;

/** Stable key: sorted params, list values sorted too (id batches in any order hit the same entry). */
export function cacheKey(endpoint: YouTubeEndpoint, params: Record<string, ParamValue>): string {
  const parts = Object.entries(params)
    .filter(([key, value]) => key !== "key" && value !== undefined && value !== null && value !== "")
    .map(([key, value]) => [key, Array.isArray(value) ? [...value].sort().join(",") : String(value)] as const)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`);
  return `${endpoint}?${parts.join("&")}`;
}
