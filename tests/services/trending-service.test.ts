import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/lib/core/logger";
import { NICHE_POOL, nichesForDay, TrendingService } from "@/lib/services/trending-service";
import type { YouTubeService } from "@/lib/youtube/service";
import type { YouTubeChannel, YouTubeVideo } from "@/types/youtube";

const NOW = new Date("2026-09-13T12:00:00Z");

const video = (id: string, channelId: string, views: number, format: "short" | "long_form" = "short") =>
  ({ id, channelId, title: `Video ${id}`, format, statistics: { viewCount: views } }) as YouTubeVideo;
const channel = (id: string, subscribers: number | null) =>
  ({ id, title: `Channel ${id}`, statistics: { subscriberCount: subscribers } }) as YouTubeChannel;

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
  it("picks the channels punching furthest above their size in each niche", async () => {
    const searchVideos = vi.fn(async ({ q }: { q?: string }) => ({
      items:
        q === nichesForDay(NOW)[0]
          ? [
              video("big00000001", "UCbig", 5_000_000), // 5M / sqrt(10M) ≈ 1.6K
              video("small000001", "UCsmall", 900_000), // 900K / sqrt(20K) ≈ 6.4K
              video("small000002", "UCsmall", 400_000),
              video("tiny0000001", "UCtiny", 90_000), // below the 100K floor
              video("long0000001", "UClong", 9_000_000, "long_form"), // not a Short
              video("mid00000001", "UCmid", 300_000), // 300K / sqrt(30K) ≈ 1.7K
            ]
          : [],
      nextPageToken: null,
      prevPageToken: null,
      totalResults: 0,
    }));
    const getChannels = vi.fn(async (ids: readonly string[]) =>
      ids.map((id) => channel(id, { UCbig: 10_000_000, UCsmall: 20_000, UCtiny: 500, UCmid: 30_000 }[id] ?? null)),
    );
    const enqueue = vi.fn(async () => ({}));
    const service = new TrendingService(
      { youtube: { searchVideos, getChannels } as unknown as YouTubeService, enqueue, latestOutput: async () => null },
      createLogger(),
    );

    const result = await service.computeDailyPicks(NOW);

    expect(searchVideos).toHaveBeenCalledTimes(5);
    expect(searchVideos).toHaveBeenCalledWith(expect.objectContaining({ videoDuration: "short", order: "viewCount" }));
    expect(result.picks.map((p) => [p.youtubeChannelId, p.videoViews, p.backup])).toEqual([
      ["UCsmall", 900_000, false],
      ["UCmid", 300_000, true],
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
