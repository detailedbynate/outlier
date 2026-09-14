import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/lib/core/logger";
import { asBackground, asUser, runWithQuotaContext } from "@/lib/youtube/quota-context";
import { nextQuotaReset, QuotaManager, QuotaUnavailableError, quotaDay, type QuotaConfig, type QuotaStore } from "@/lib/youtube/quota-manager";
import { cacheKey, type CachedResponse, type ResponseCacheStore } from "@/lib/youtube/response-cache";
import { YouTubeService } from "@/lib/youtube/service";
import { createFakeYouTube, listBody, rawVideo } from "../helpers/youtube";
import { YouTubeClient } from "@/lib/youtube/client";

const CONFIG: QuotaConfig = { dailyUnits: 1_000, userReserveUnits: 300, safetyBufferUnits: 100, tiers: { default: { userDailyUnits: 150 }, pro: { userDailyUnits: 400 } } };
const NOW = new Date("2026-09-16T18:00:00Z"); // 11:00 Pacific

/** In-memory store with the same semantics as consume_youtube_quota. */
function memoryStore(): QuotaStore & { rows: { day: string; lane: string; operation: string; userKey: string; units: number; requests: number; denied: number }[] } {
  const rows: { day: string; lane: "background" | "user"; operation: string; userKey: string; units: number; requests: number; denied: number }[] = [];
  const row = (day: string, lane: "background" | "user", operation: string, userKey: string) => {
    let found = rows.find((r) => r.day === day && r.lane === lane && r.operation === operation && r.userKey === userKey);
    if (!found) rows.push((found = { day, lane, operation, userKey, units: 0, requests: 0, denied: 0 }));
    return found;
  };
  return {
    rows,
    consume: async (i) => {
      const sum = (f: (r: (typeof rows)[number]) => boolean) => rows.filter((r) => r.day === i.day && f(r)).reduce((a, r) => a + r.units, 0);
      const total = sum(() => true);
      const lane = sum((r) => r.lane === i.lane);
      const user = i.userKey ? sum((r) => r.lane === i.lane && r.userKey === i.userKey) : 0;
      const target = row(i.day, i.lane, i.operation, i.userKey);
      if (total + i.units > i.totalLimit || lane + i.units > i.laneLimit || (i.userLimit !== null && user + i.units > i.userLimit)) {
        target.denied += 1;
        return false;
      }
      target.units += i.units;
      target.requests += 1;
      return true;
    },
    usage: async (day) => rows.filter((r) => r.day === day),
  };
}

describe("quota day", () => {
  it("uses the Pacific calendar day and finds the next midnight Pacific", () => {
    expect(quotaDay(new Date("2026-09-17T06:30:00Z"))).toBe("2026-09-16"); // 23:30 PDT
    expect(nextQuotaReset(new Date("2026-09-17T06:30:00Z")).toISOString()).toBe("2026-09-17T07:00:00.000Z");
    expect(nextQuotaReset(new Date("2026-12-01T12:00:00Z")).toISOString()).toBe("2026-12-02T08:00:00.000Z"); // PST
  });
});

describe("QuotaManager", () => {
  it("caps background work so the user reserve is never touched", async () => {
    const manager = new QuotaManager(memoryStore(), CONFIG, createLogger());
    expect(manager.limits()).toEqual({ total: 900, background: 600, user: 900, perUser: 150 });
    const background = { lane: "background" as const, operation: "job:monitor" };
    for (let i = 0; i < 6; i++) await manager.acquire({ endpoint: "search", units: 100 }, background, NOW);
    await expect(manager.acquire({ endpoint: "videos", units: 1 }, background, NOW)).rejects.toBeInstanceOf(QuotaUnavailableError);
    // Users still have the reserve.
    await expect(manager.acquire({ endpoint: "search", units: 100 }, { lane: "user", operation: "page", userId: "u1" }, NOW)).resolves.toBeUndefined();
  });

  it("applies per-user limits by tier and explains the denial", async () => {
    const manager = new QuotaManager(memoryStore(), CONFIG, createLogger());
    const free = { lane: "user" as const, operation: "page", userId: "u1" };
    await manager.acquire({ endpoint: "search", units: 100 }, free, NOW);
    const denied = await manager.acquire({ endpoint: "search", units: 100 }, free, NOW).catch((e: unknown) => e);
    expect(denied).toBeInstanceOf(QuotaUnavailableError);
    expect((denied as QuotaUnavailableError).message).toMatch(/You've reached today's YouTube data limit/);
    expect((denied as QuotaUnavailableError).retryAt.toISOString()).toBe("2026-09-17T07:00:00.000Z");
    await expect(manager.acquire({ endpoint: "search", units: 100 }, { ...free, userId: "u2", tier: "pro" }, NOW)).resolves.toBeUndefined();
    expect(await manager.remainingForUser("u1", "default", NOW)).toBe(50);
  });

  it("applies per-account unit overrides, with no cap for unlimited accounts", async () => {
    const limits = async (userId: string) => (userId === "owner" ? { dailyUnits: null } : userId === "small" ? { dailyUnits: 50 } : null);
    const manager = new QuotaManager(memoryStore(), CONFIG, createLogger(), limits);
    const ctx = (userId: string) => ({ lane: "user" as const, operation: "page", userId });
    await expect(manager.acquire({ endpoint: "search", units: 100 }, ctx("small"), NOW)).rejects.toBeInstanceOf(QuotaUnavailableError);
    for (let i = 0; i < 5; i++) await manager.acquire({ endpoint: "search", units: 100 }, ctx("owner"), NOW);
    expect(await manager.remainingForUser("owner", "default", NOW)).toBe(Number.POSITIVE_INFINITY);
  });

  it("summarizes usage by lane and operation", async () => {
    const manager = new QuotaManager(memoryStore(), CONFIG, createLogger());
    await manager.acquire({ endpoint: "videos", units: 1 }, { lane: "background", operation: "job:monitor.videos" }, NOW);
    await manager.acquire({ endpoint: "search", units: 100 }, { lane: "user", operation: "action:discover", userId: "u1" }, NOW);
    const summary = await manager.summary(NOW);
    expect(summary).toMatchObject({ day: "2026-09-16", used: { total: 101, background: 1, user: 100 }, denied: 0 });
    expect(summary.byOperation[0]).toMatchObject({ operation: "action:discover", units: 100 });
  });

  it("fails open when the ledger is unreachable", async () => {
    const store: QuotaStore = { consume: vi.fn().mockRejectedValue(new Error("db down")), usage: async () => [] };
    await expect(new QuotaManager(store, CONFIG, createLogger()).acquire({ endpoint: "videos", units: 1 }, { lane: "user", operation: "x" }, NOW)).resolves.toBeUndefined();
  });

  it("rejects reserves that leave nothing for background work", () => {
    expect(() => new QuotaManager(memoryStore(), { ...CONFIG, userReserveUnits: 950 })).toThrow(/smaller than the daily quota/);
  });
});

function memoryCache(): ResponseCacheStore & { entries: Map<string, CachedResponse> } {
  const entries = new Map<string, CachedResponse>();
  return {
    entries,
    get: async (key) => entries.get(key) ?? null,
    set: async (key, _endpoint, body, expiresAt) => void entries.set(key, { body, fetchedAt: new Date(), expiresAt }),
  };
}

describe("YouTubeClient quota gate and cache", () => {
  const VIDEO = "abcdefghijk";

  function setup(options: { quota?: { acquire: () => Promise<void> } } = {}) {
    const fake = createFakeYouTube([{ endpoint: "videos", body: listBody([rawVideo(VIDEO, { views: "500" })]) }]);
    const cache = memoryCache();
    const acquire = vi.fn(options.quota?.acquire ?? (async () => {}));
    const client = new YouTubeClient({
      apiKey: "test-key",
      fetch: fake.fetchMock as unknown as typeof fetch,
      sleep: async () => {},
      quota: { acquire },
      cache,
      logger: createLogger(),
    });
    return { service: new YouTubeService(client), fetchMock: fake.fetchMock, cache, acquire };
  }

  it("checks quota with the caller's context and reuses cached responses across users", async () => {
    const { service, fetchMock, acquire } = setup();
    await asUser("u1", "page:analyze", () => service.getVideos([VIDEO]));
    await asUser("u2", "page:analyze", () => service.getVideos([VIDEO]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledWith({ endpoint: "videos", units: 1 }, expect.objectContaining({ lane: "user", userId: "u1", operation: "page:analyze" }));
  });

  it("bypasses the cache for fresh-data contexts without writing new entries", async () => {
    const { service, fetchMock, cache } = setup();
    await asBackground("job:monitor.videos", () => service.getVideos([VIDEO]), { fresh: true });
    await asBackground("job:monitor.videos", () => service.getVideos([VIDEO]), { fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cache.entries.size).toBe(0);
  });

  it("serves stale cache when quota is unavailable, and throws without it", async () => {
    const acquire = async (): Promise<void> => {
      throw new QuotaUnavailableError("user", new Date(), "daily");
    };
    const { service, fetchMock, cache } = setup({ quota: { acquire } });
    await expect(service.getVideos([VIDEO])).rejects.toBeInstanceOf(QuotaUnavailableError);

    const key = cacheKey("videos", { part: ["snippet", "statistics", "contentDetails", "status", "topicDetails", "liveStreamingDetails"], id: [VIDEO], maxResults: 50 });
    cache.entries.set(key, { body: listBody([rawVideo(VIDEO, { views: "42" })]), fetchedAt: new Date(Date.now() - 3 * 3_600_000), expiresAt: new Date(Date.now() + 86_400_000) });
    const [video] = await runWithQuotaContext({ lane: "user", operation: "x" }, () => service.getVideos([VIDEO]));
    expect(video?.statistics.viewCount).toBe(42);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("builds order-insensitive cache keys without the API key", () => {
    expect(cacheKey("videos", { id: ["b", "a"], part: "snippet", key: "secret" })).toBe(cacheKey("videos", { part: "snippet", id: ["a", "b"] }));
    expect(cacheKey("videos", { id: ["a"], key: "secret" })).not.toContain("secret");
  });
});
