import type { z } from "zod";
import { AppError, UpstreamError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";
import { youtubeErrorBodySchema } from "./schemas";

/**
 * Low-level YouTube Data API v3 HTTP client: auth, timeouts, retries, response
 * validation, error mapping, and quota accounting. Knows nothing about domain types.
 */

export type YouTubeEndpoint = "channels" | "videos" | "search" | "playlists" | "playlistItems" | "videoCategories";

/** Quota unit cost per call (https://developers.google.com/youtube/v3/determine_quota_cost). */
export const QUOTA_COST: Record<YouTubeEndpoint, number> = {
  channels: 1,
  videos: 1,
  search: 100,
  playlists: 1,
  playlistItems: 1,
  videoCategories: 1,
};

export type QueryValue = string | number | boolean | readonly string[] | null | undefined;

export interface QuotaUsage {
  endpoint: YouTubeEndpoint;
  units: number;
  status: number;
}

export interface YouTubeClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Called after every request (successful or not) — hook for usage_events metering. */
  onQuotaUsage?: (usage: QuotaUsage) => void;
  logger?: Logger;
}

const RETRYABLE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "backendError", "internalError"]);
const QUOTA_REASONS = new Set(["quotaExceeded", "dailyLimitExceeded"]);

export class YouTubeApiError extends UpstreamError {
  readonly httpStatus: number;
  readonly reason: string | undefined;

  constructor(message: string, httpStatus: number, reason: string | undefined, retryable: boolean) {
    super("YouTube API", message, { retryable, details: { httpStatus, reason } });
    this.httpStatus = httpStatus;
    this.reason = reason;
  }
}

export class YouTubeClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onQuotaUsage?: (usage: QuotaUsage) => void;
  private readonly log: Logger;

  constructor(options: YouTubeClientOptions) {
    if (!options.apiKey) throw new AppError("CONFIG_ERROR", "YouTube API key is required", { expose: false });
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://www.googleapis.com/youtube/v3").replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.onQuotaUsage = options.onQuotaUsage;
    this.log = options.logger ?? createLogger({ module: "youtube.client" });
  }

  async get<T extends z.ZodType>(endpoint: YouTubeEndpoint, params: Record<string, QueryValue>, schema: T): Promise<z.infer<T>> {
    const url = this.buildUrl(endpoint, params);
    let attempt = 0;

    for (;;) {
      attempt += 1;
      const startedAt = Date.now();
      let response: Response;

      try {
        response = await this.fetchImpl(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(this.timeoutMs),
          cache: "no-store",
        });
      } catch (cause) {
        const timedOut = cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
        const error = new YouTubeApiError(timedOut ? `Request timed out after ${this.timeoutMs}ms` : "Network error", 0, undefined, true);
        if (attempt <= this.maxRetries) {
          await this.backoff(endpoint, attempt, error);
          continue;
        }
        throw error;
      }

      // YouTube charges quota for failed requests too.
      this.onQuotaUsage?.({ endpoint, units: QUOTA_COST[endpoint], status: response.status });
      this.log.debug("youtube request", { endpoint, status: response.status, attempt, durationMs: Date.now() - startedAt });

      if (response.ok) {
        const body: unknown = await response.json();
        const parsed = schema.safeParse(body);
        if (!parsed.success) {
          throw new YouTubeApiError(`Unexpected response shape from ${endpoint}`, response.status, "invalidResponse", false);
        }
        return parsed.data;
      }

      const error = await this.toError(endpoint, response);
      if (error.retryable && attempt <= this.maxRetries) {
        await this.backoff(endpoint, attempt, error);
        continue;
      }
      throw error;
    }
  }

  private buildUrl(endpoint: YouTubeEndpoint, params: Record<string, QueryValue>): string {
    const url = new URL(`${this.baseUrl}/${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }
    url.searchParams.set("key", this.apiKey);
    return url.toString();
  }

  private async toError(endpoint: YouTubeEndpoint, response: Response): Promise<AppError> {
    let message = `${endpoint} request failed with HTTP ${response.status}`;
    let reason: string | undefined;
    try {
      const parsed = youtubeErrorBodySchema.safeParse(await response.json());
      if (parsed.success) {
        message = parsed.data.error.message ?? message;
        reason = parsed.data.error.errors?.[0]?.reason;
      }
    } catch {
      // Non-JSON error body; keep the generic message.
    }

    if (reason && QUOTA_REASONS.has(reason)) {
      return new AppError("QUOTA_EXCEEDED", "YouTube API daily quota exceeded", {
        details: { endpoint, reason },
        retryable: false,
        expose: true,
      });
    }
    if (response.status === 404) {
      return new AppError("NOT_FOUND", message, { details: { endpoint, reason } });
    }
    if (response.status === 400) {
      return new AppError("BAD_REQUEST", `YouTube rejected the request: ${message}`, { details: { endpoint, reason } });
    }

    const retryable = response.status >= 500 || response.status === 429 || (reason !== undefined && RETRYABLE_REASONS.has(reason));
    if (response.status === 401 || response.status === 403) {
      // Key misconfiguration: log loudly, don't leak details to callers.
      if (!retryable) {
        this.log.error("youtube auth/permission error", { endpoint, status: response.status, reason, message });
        return new AppError("UPSTREAM_ERROR", "YouTube API rejected the server's credentials", {
          details: { endpoint, reason },
          expose: true,
        });
      }
    }
    return new YouTubeApiError(message, response.status, reason, retryable);
  }

  private async backoff(endpoint: YouTubeEndpoint, attempt: number, error: AppError): Promise<void> {
    const delay = Math.min(250 * 2 ** (attempt - 1), 4_000) + Math.floor(Math.random() * 100);
    this.log.warn("youtube request retrying", { endpoint, attempt, delayMs: delay, error: error.message });
    await this.sleep(delay);
  }
}
