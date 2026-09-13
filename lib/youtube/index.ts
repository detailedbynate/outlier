import "server-only";
import { env, requireEnv } from "@/lib/core/env";
import { YouTubeClient } from "./client";
import { YouTubeService } from "./service";

export { YouTubeClient, YouTubeApiError, QUOTA_COST, type QuotaUsage } from "./client";
export { YouTubeService, searchParamsSchema, type SearchParams, type PageOptions } from "./service";
export * from "./parse";

let service: YouTubeService | undefined;

/** Shared, env-configured YouTube service for server code. */
export function getYouTubeService(): YouTubeService {
  if (!service) {
    const config = env();
    const client = new YouTubeClient({
      apiKey: requireEnv("YOUTUBE_API_KEY"),
      baseUrl: config.YOUTUBE_API_BASE_URL,
      timeoutMs: config.YOUTUBE_REQUEST_TIMEOUT_MS,
      maxRetries: config.YOUTUBE_MAX_RETRIES,
    });
    service = new YouTubeService(client);
  }
  return service;
}
