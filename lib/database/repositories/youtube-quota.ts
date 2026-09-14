import type { DatabaseClient } from "@/lib/database/client";
import { assertOk, unwrap } from "@/lib/database/errors";
import type { CachedResponse, ResponseCacheStore } from "@/lib/youtube/response-cache";
import type { QuotaStore } from "@/lib/youtube/quota-manager";
import type { YouTubeEndpoint } from "@/lib/youtube/client";

/** Postgres-backed quota ledger (atomic check-and-record via `consume_youtube_quota`). */
export class YouTubeQuotaRepository implements QuotaStore {
  constructor(private readonly db: DatabaseClient) {}

  async consume(input: Parameters<QuotaStore["consume"]>[0]): Promise<boolean> {
    return unwrap(
      await this.db.rpc("consume_youtube_quota", {
        p_day: input.day,
        p_lane: input.lane,
        p_operation: input.operation.slice(0, 100),
        p_user_key: input.userKey,
        p_units: input.units,
        p_total_limit: input.totalLimit,
        p_lane_limit: input.laneLimit,
        p_user_limit: input.userLimit,
      }),
      "youtube_quota.consume",
    );
  }

  async usage(day: string): ReturnType<QuotaStore["usage"]> {
    const rows = unwrap(
      await this.db.from("youtube_quota_usage").select("lane, operation, user_key, units, requests, denied").eq("day", day),
      "youtube_quota.usage",
    );
    return rows.map((r) => ({ lane: r.lane, operation: r.operation, userKey: r.user_key, units: r.units, requests: r.requests, denied: r.denied }));
  }

  /** Keep a few months of history for reporting. */
  async deleteBefore(day: string): Promise<void> {
    assertOk(await this.db.from("youtube_quota_usage").delete().lt("day", day), "youtube_quota.prune");
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Postgres-backed response cache. Keys are hashed so long id batches stay compact. */
export class YouTubeCacheRepository implements ResponseCacheStore {
  constructor(private readonly db: DatabaseClient) {}

  async get(key: string): Promise<CachedResponse | null> {
    const rows = unwrap(
      await this.db
        .from("youtube_api_cache")
        .select("response, fetched_at, expires_at")
        .eq("cache_key", await sha256Hex(key))
        .gt("expires_at", new Date().toISOString())
        .limit(1),
      "youtube_cache.get",
    );
    const row = rows[0];
    return row ? { body: row.response, fetchedAt: new Date(row.fetched_at), expiresAt: new Date(row.expires_at) } : null;
  }

  async set(key: string, endpoint: YouTubeEndpoint, body: unknown, expiresAt: Date): Promise<void> {
    assertOk(
      await this.db.from("youtube_api_cache").upsert(
        {
          cache_key: await sha256Hex(key),
          endpoint,
          response: body as never,
          fetched_at: new Date().toISOString(),
          expires_at: expiresAt.toISOString(),
        },
        { onConflict: "cache_key" },
      ),
      "youtube_cache.set",
    );
  }

  async pruneExpired(now: Date = new Date()): Promise<void> {
    assertOk(await this.db.from("youtube_api_cache").delete().lt("expires_at", now.toISOString()), "youtube_cache.prune");
  }
}
