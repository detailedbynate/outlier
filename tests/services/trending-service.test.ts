import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/lib/core/logger";
import { NICHE_POOL, nichesForDay, TrendingService } from "@/lib/services/trending-service";
import type { YouTubeService } from "@/lib/youtube/service";
import { makeChannel, makeVideo } from "../helpers/fixtures";

const NOW = new Date("2026-09-13T12:00:00Z");


describe("nichesForDay", () => {
  it("returns 5 distinct niches that rotate day to day", () => {
    const today = nichesForDay(NOW);
    const tomorrow = nichesForDay(new Date(NOW.getTime() + 86_400_000));
    expect(new Set(today).size).toBe(5);
    expect(today.every((n) => (NICHE_POOL as readonly string[]).includes(n))).toBe(true);
    expect(tomorrow).not.toEqual(today);
  });
});

describe("TrendingService.computeDailyPicks", () => {
  it("keeps only quality, underrated Shorts and ranks the best per niche", async () => {
    const searchVideos = vi.fn(async ({ q }: { q?: string }) => ({
      items:
        q === nichesForDay(NOW)[0]
          ? [
              makeVideo({ id: "big00000001", channelId: "UCbig", views: 5_000_000 }), // too big a channel
              makeVideo({ id: "small000001", channelId: "UCsmall", views: 900_000 }),
              makeVideo({ id: "small000002", channelId: "UCsmall", views: 400_000 }),
              makeVideo({ id: "spain000001", channelId: "UCspain", views: 3_000_000 }), // wrong country
              makeVideo({ id: "long0000001", channelId: "UClong", views: 9_000_000, format: "long_form" }), // not a Short
              makeVideo({ id: "mid00000001", channelId: "UCmid", views: 400_000 }),
            ]
          : [],
      nextPageToken: null,
      prevPageToken: null,
      totalResults: 0,
    }));
    const getChannels = vi.fn(async (ids: readonly string[]) =>
      ids.map((id) =>
        makeChannel({
          id,
          country: id === "UCspain" ? "ES" : "US",
          subscribers: { UCbig: 10_000_000, UCsmall: 20_000, UCspain: 5_000, UCmid: 30_000 }[id] ?? null,
        }),
      ),
    );
    const enqueue = vi.fn(async () => ({}));
    const service = new TrendingService(
      { youtube: { searchVideos, getChannels } as unknown as YouTubeService, enqueue, latestOutput: async () => null, regionCode: "US" },
      createLogger(),
    );

    const result = await service.computeDailyPicks(NOW);

    expect(searchVideos).toHaveBeenCalledTimes(5);
    expect(searchVideos).toHaveBeenCalledWith(expect.objectContaining({ videoDuration: "short", order: "viewCount", regionCode: "US", relevanceLanguage: "en" }));
    expect(result.picks.map((p) => [p.youtubeChannelId, p.videoViews, p.backup])).toEqual([
      ["UCsmall", 900_000, false],
      ["UCmid", 400_000, true],
    ]);
    expect(enqueue).toHaveBeenCalledWith(
      "channel.refresh",
      { channelId: "UCsmall", light: true },
      expect.objectContaining({ idempotencyKey: "channel.refresh:UCsmall:2026-09-13" }),
    );
  });
  it("keeps going when one niche fails", async () => {
    const searchVideos = vi.fn(async () => {
      throw new Error("quota");
    });
    const service = new TrendingService(
      {
        youtube: { searchVideos, getChannels: async () => [] } as unknown as YouTubeService,
        enqueue: async () => ({}),
        latestOutput: async () => null,
      },
      createLogger(),
    );
    await expect(service.computeDailyPicks(NOW)).resolves.toMatchObject({ picks: [] });
    expect(searchVideos).toHaveBeenCalledTimes(5);
  });

  it("ignores malformed stored picks", async () => {
    const service = new TrendingService(
      {
        youtube: {} as YouTubeService,
        enqueue: async () => ({}),
        latestOutput: async () => ({ output: { skipped: "storage_budget" }, finishedAt: null }),
      },
      createLogger(),
    );
    expect(await service.latestPicks()).toBeNull();
  });
});
