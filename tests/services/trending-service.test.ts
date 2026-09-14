import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/lib/core/logger";
import type { TrendingRepository } from "@/lib/database/repositories/trending";
import { deltaAgo, GAMING_POOL, NICHE_POOL, nicheLabel, nichesForDay, TrendingService } from "@/lib/services/trending-service";
import type { YouTubeService } from "@/lib/youtube/service";
import type { TablesInsert, TrendingPickRow, TrendingPickStatRow } from "@/types/database";
import { makeChannel, makeVideo } from "../helpers/fixtures";

const NOW = new Date("2026-09-13T12:00:00Z");

/** In-memory stand-in for TrendingRepository. */
function fakeRepository() {
  let picks: TrendingPickRow[] = [];
  let stats: TrendingPickStatRow[] = [];
  let nextId = 1;
  const id = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;
  const repository = {
    latest: async () => {
      const newest = picks.map((p) => p.pick_date).sort().at(-1);
      return picks.filter((p) => p.pick_date === newest);
    },
    replaceForDate: async (date: string, rows: TablesInsert<"trending_picks">[]) => {
      picks = picks.filter((p) => p.pick_date !== date);
      const saved = rows.map(
        (row) =>
          ({
            rank: 0,
            channel_thumbnail_url: null,
            channel_country: null,
            subscriber_count: null,
            video_published_at: null,
            video_views: 0,
            video_likes: null,
            video_comments: null,
            channel_median_views: null,
            outlier_multiplier: null,
            underrated_score: null,
            views_1h: null,
            views_24h: null,
            stats_updated_at: null,
            created_at: NOW.toISOString(),
            ...row,
            id: id(),
          }) as TrendingPickRow,
      );
      picks.push(...saved);
      return saved;
    },
    clearAll: async () => {
      picks = [];
    },
    deletePick: async (pickId: string) => {
      picks = picks.filter((p) => p.id !== pickId);
    },
    updatePick: async (pickId: string, patch: Partial<TrendingPickRow>) => {
      picks = picks.map((p) => (p.id === pickId ? { ...p, ...patch } : p));
    },
    insertStats: async (rows: TablesInsert<"trending_pick_stats">[]) => {
      for (const row of rows) stats.push({ id: id(), likes: null, comments: null, captured_at: NOW.toISOString(), ...row } as TrendingPickStatRow);
    },
    statsSince: async (ids: string[], since: Date) =>
      stats.filter((s) => ids.includes(s.pick_id) && Date.parse(s.captured_at) >= since.getTime()).sort((a, b) => a.captured_at.localeCompare(b.captured_at)),
    pruneStats: async (olderThan: Date) => {
      stats = stats.filter((s) => Date.parse(s.captured_at) >= olderThan.getTime());
    },
  } satisfies Partial<TrendingRepository>;
  return { repository, all: () => picks, stats: () => stats };
}

const page = <T,>(items: T[]) => ({ items, nextPageToken: null, prevPageToken: null, totalResults: items.length });

describe("nichesForDay", () => {
  it("returns 3 gaming categories then 2 other niches, rotating day to day", () => {
    const today = nichesForDay(NOW);
    const tomorrow = nichesForDay(new Date(NOW.getTime() + 86_400_000));
    expect(new Set(today).size).toBe(5);
    expect(today.slice(0, 3).every((n) => (GAMING_POOL as readonly string[]).includes(n))).toBe(true);
    expect(today.slice(3).every((n) => (NICHE_POOL as readonly string[]).includes(n))).toBe(true);
    expect(nicheLabel(today[0]!)).toBe(`gaming · ${today[0]}`);
    expect(tomorrow).not.toEqual(today);
  });
});

describe("deltaAgo", () => {
  const at = (hoursBefore: number, views: number) => ({ captured_at: new Date(NOW.getTime() - hoursBefore * 3_600_000).toISOString(), views });

  it("uses the stat closest to the target time within tolerance", () => {
    const stats = [at(25, 100), at(23, 200), at(1, 900), at(0, 1_000)];
    expect(deltaAgo(stats, 24, 6)).toBe(900);
    expect(deltaAgo(stats, 1, 0.75)).toBe(100);
  });

  it("returns null without history in range", () => {
    expect(deltaAgo([at(0, 1_000)], 1, 0.75)).toBeNull();
    expect(deltaAgo([at(5, 10), at(0, 1_000)], 1, 0.75)).toBeNull();
  });
});

describe("TrendingService.computeDailyPicks", () => {
  function setup() {
    const firstNiche = nichesForDay(NOW)[0];
    const searchVideos = vi.fn(async ({ q }: { q?: string }) =>
      page(
        q === firstNiche
          ? [
              makeVideo({ id: "big00000001", channelId: "UCbig", views: 5_000_000 }), // too big a channel
              makeVideo({ id: "small000001", channelId: "UCsmall", views: 900_000 }),
              makeVideo({ id: "small000002", channelId: "UCsmall", views: 400_000 }),
              makeVideo({ id: "spain000001", channelId: "UCspain", views: 3_000_000 }), // wrong country
              makeVideo({ id: "long0000001", channelId: "UClong", views: 9_000_000, format: "long_form" }), // not a Short
              makeVideo({ id: "mid00000001", channelId: "UCmid", views: 400_000 }),
              makeVideo({ id: "usual000001", channelId: "UCusual", views: 500_000 }), // normal for its channel
            ]
          : [],
      ),
    );
    const getChannels = vi.fn(async (ids: readonly string[]) =>
      ids.map((id) =>
        makeChannel({
          id,
          country: id === "UCspain" ? "ES" : "US",
          subscribers: { UCbig: 10_000_000, UCsmall: 20_000, UCspain: 5_000, UCmid: 30_000, UCusual: 25_000 }[id] ?? null,
        }),
      ),
    );
    const baselines: Record<string, number> = { UCsmall: 100_000, UCmid: 100_000, UCusual: 450_000 };
    const getChannelVideos = vi.fn(async (channelId: string) =>
      page(Array.from({ length: 10 }, (_, i) => makeVideo({ id: `${channelId}-${i}`, channelId, views: baselines[channelId] ?? 1_000 }))),
    );
    const getVideos = vi.fn(async () => []);
    const enqueue = vi.fn(async () => ({}));
    const fake = fakeRepository();
    const service = new TrendingService(
      {
        youtube: { searchVideos, getChannels, getChannelVideos, getVideos } as unknown as YouTubeService,
        repository: fake.repository,
        enqueue,
      },
      { regionCode: "US", minMultiplier: 2 },
      createLogger(),
    );
    return { service, searchVideos, getChannelVideos, enqueue, fake };
  }

  it("keeps small, quality channels whose Short beats their own median", async () => {
    const { service, searchVideos, enqueue, fake } = setup();

    const result = await service.computeDailyPicks(NOW);

    expect(searchVideos).toHaveBeenCalledWith(
      expect.objectContaining({ videoDuration: "short", order: "viewCount", regionCode: "US", relevanceLanguage: "en" }),
    );
    expect(result).toMatchObject({ date: "2026-09-13", picks: 2 });
    expect(fake.all().map((p) => [p.youtube_channel_id, p.rank, p.video_views, p.outlier_multiplier])).toEqual([
      ["UCsmall", 0, 900_000, 9],
      ["UCmid", 1, 400_000, 4],
    ]);
    expect(fake.stats()).toHaveLength(2);
    expect(enqueue).toHaveBeenCalledWith(
      "channel.refresh",
      { channelId: "UCsmall", light: true },
      expect.objectContaining({ idempotencyKey: "channel.refresh:UCsmall:2026-09-13" }),
    );
  });

  it("tries extra niches when some come back empty and survives failures", async () => {
    const { service, searchVideos } = setup();
    searchVideos.mockImplementationOnce(async () => {
      throw new Error("quota");
    });
    const result = await service.computeDailyPicks(NOW);
    expect(searchVideos).toHaveBeenCalledTimes(9); // 3+2 gaming, 2+2 other
    expect(result.picks).toBe(0);
  });

  it("replaces the day's picks when re-run", async () => {
    const { service, fake } = setup();
    await service.computeDailyPicks(NOW);
    await service.computeDailyPicks(NOW);
    expect(fake.all()).toHaveLength(2);
  });
});

describe("TrendingService picks", () => {
  async function seeded() {
    const fake = fakeRepository();
    await fake.repository.replaceForDate("2026-09-13", [
      { pick_date: "2026-09-13", niche: "cooking", rank: 0, youtube_channel_id: "UCa", channel_title: "A", youtube_video_id: "vida", video_title: "A", video_views: 1_000, subscriber_count: 500, channel_median_views: 200, video_likes: 40, video_comments: 10 },
      { pick_date: "2026-09-13", niche: "cooking", rank: 1, youtube_channel_id: "UCb", channel_title: "B", youtube_video_id: "vidb", video_title: "B", video_views: 800 },
      { pick_date: "2026-09-13", niche: "pets", rank: 0, youtube_channel_id: "UCc", channel_title: "C", youtube_video_id: "vidc", video_title: "C", video_views: 600 },
    ]);
    return fake;
  }

  it("shows the best pick per niche and fills in the backup after a removal", async () => {
    const fake = await seeded();
    const service = new TrendingService({ youtube: {} as YouTubeService, repository: fake.repository, enqueue: async () => ({}) }, {}, createLogger());

    const picks = await service.currentPicks();
    expect(picks.map((p) => p.youtube_channel_id)).toEqual(["UCa", "UCc"]);
    expect(picks[0]).toMatchObject({ viewsPerSub: 2, engagement: 0.05 });

    await service.removePick(picks[0]!.id);
    expect((await service.currentPicks()).map((p) => p.youtube_channel_id)).toEqual(["UCb", "UCc"]);

    await service.clearAll();
    expect(await service.currentPicks()).toEqual([]);
  });

  it("refreshes views, multiplier, and hourly gains", async () => {
    const fake = await seeded();
    const [first] = fake.all();
    await fake.repository.insertStats([{ pick_id: first!.id, views: 1_000, captured_at: new Date(NOW.getTime() - 3_600_000).toISOString() }]);
    const getVideos = vi.fn(async (ids: readonly string[]) => ids.map((id) => makeVideo({ id, views: id === "vida" ? 1_600 : 700 })));
    const getChannels = vi.fn(async (ids: readonly string[]) => ids.map((id) => makeChannel({ id, subscribers: 900 })));
    const service = new TrendingService(
      { youtube: { getVideos, getChannels } as unknown as YouTubeService, repository: fake.repository, enqueue: async () => ({}) },
      {},
      createLogger(),
    );

    expect(await service.refreshStats(NOW)).toEqual({ refreshed: 3 });
    expect(fake.all().find((p) => p.id === first!.id)).toMatchObject({
      video_views: 1_600,
      subscriber_count: 900,
      outlier_multiplier: 8,
      views_1h: 600,
      views_24h: null,
    });
  });
});
