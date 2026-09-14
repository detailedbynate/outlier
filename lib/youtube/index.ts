import "server-only";
import { env, requireEnv } from "@/lib/core/env";
import { getAdminDatabase } from "@/lib/database/client";
import { YouTubeCacheRepository, YouTubeQuotaRepository } from "@/lib/database/repositories/youtube-quota";
import { YouTubeClient } from "./client";
import { QuotaManager, type QuotaConfig } from "./quota-manager";
import { YouTubeService } from "./service";

export { YouTubeClient, YouTubeApiError, QUOTA_COST, type QuotaUsage } from "./client";
export { YouTubeService, searchParamsSchema, type SearchParams, type PageOptions } from "./service";
export { QuotaManager, QuotaUnavailableError, isQuotaUnavailable, quotaDay, nextQuotaReset } from "./quota-manager";
export { asBackground, asUser, currentQuotaContext, runWithQuotaContext, type QuotaContext } from "./quota-context";
export * from "./parse";

let service: YouTubeService | undefined;
let quota: QuotaManager | undefined;

export function quotaConfigFromEnv(config = env()): QuotaConfig {
  return {
    dailyUnits: config.YOUTUBE_DAILY_QUOTA,
    userReserveUnits: config.YOUTUBE_USER_RESERVE_UNITS,
    safetyBufferUnits: config.YOUTUBE_SAFETY_BUFFER_UNITS,
    tiers: {
      default: { userDailyUnits: config.YOUTUBE_USER_DAILY_UNITS },
      // Future subscription tiers scale the default allowance.
      pro: { userDailyUnits: config.YOUTUBE_USER_DAILY_UNITS * 3 },
    },
  };
}

/** Shared quota manager (reads and records usage in Postgres). */
export function getQuotaManager(): QuotaManager {
  quota ??= new QuotaManager(new YouTubeQuotaRepository(getAdminDatabase()), quotaConfigFromEnv());
  return quota;
}

/**
 * Shared, env-configured YouTube service for server code. The only way the app
 * reaches the YouTube API: every request is quota-gated and cached.
 */
export function getYouTubeService(): YouTubeService {
  if (!service) {
    const config = env();
    const gated = config.YOUTUBE_QUOTA_ENFORCED;
    const client = new YouTubeClient({
      apiKey: requireEnv("YOUTUBE_API_KEY"),
      baseUrl: config.YOUTUBE_API_BASE_URL,
      timeoutMs: config.YOUTUBE_REQUEST_TIMEOUT_MS,
      maxRetries: config.YOUTUBE_MAX_RETRIES,
      quota: gated ? getQuotaManager() : undefined,
      cache: config.YOUTUBE_CACHE_ENABLED ? new YouTubeCacheRepository(getAdminDatabase()) : undefined,
    });
    service = new YouTubeService(client);
  }
  return service;
}