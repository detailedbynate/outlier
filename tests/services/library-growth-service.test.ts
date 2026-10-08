import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/lib/core/logger";
import { LibraryGrowthService } from "@/lib/services/library-growth-service";
import { LIBRARY_GROWTH_EVENT } from "@/lib/services/research-service";
import { QuotaUnavailableError } from "@/lib/youtube/quota-manager";

const NOW = new Date("2026-09-16T12:00:00Z");

function setup(options: {
  seeds?: string[];
  longFormSeeds?: string[];
  counts?: Record<string, number>;
  recent?: string[];
  usedToday?: number;
  discover?: (keyword: string) => Promise<unknown>;
  config?: Partial<{ searchesPerRun: number; dailySearches: number; reseedDays: number; featuredChecksPerRun: number; featuredNewPerRun: number }>;
  sources?: { id: string; youtube_channel_id: string }[];
  featured?: Record<string, string[] | Error>;
  known?: string[];
} = {}) {
  const discoverShortsChannels = vi.fn(async (keyword: string) =>
    options.discover ? options.discover(keyword) : { keyword, channelsFound: 10, channelsNew: 8, channelsQueued: 8, alreadyFresh: 0, searchesLeftToday: 0, searchPasses: 1 },
  );
  const topResources = vi.fn(async () => options.recent ?? []);
  const countSince = vi.fn(async () => options.usedToday ?? 0);
  const getFeaturedChannels = vi.fn(async (id: string) => {
    const result = options.featured?.[id] ?? [];
    if (result instanceof Error) throw result;
    return result;
  });
  const listForFeaturedCheck = vi.fn(async () => options.sources ?? []);
  const markFeaturedChecked = vi.fn(async () => {});
  const enqueue = vi.fn(async () => ({}));
  const service = new LibraryGrowthService(
    {
      research: { discoverShortsChannels } as never,
      usage: { topResources, countSince } as never,
      niches: { channelCountsBySlug: async () => new Map(Object.entries(options.counts ?? {})) } as never,
      seeds: options.seeds ?? ["clash royale", "geometry dash", "sourdough", "pottery"],
      longFormSeeds: options.longFormSeeds,
      youtube: { getFeaturedChannels } as never,
      channels: {
        listForFeaturedCheck,
        markFeaturedChecked,
        existingIds: async (ids: string[]) => new Set(ids.filter((id) => (options.known ?? []).includes(id))),
      } as never,
      enqueue,
    },
    { searchesPerRun: 3, dailySearches: 12, reseedDays: 14, featuredChecksPerRun: 10, featuredNewPerRun: 50, featuredMaxSubscribers: 1_000_000, ...options.config },
    createLogger(),
  );
  return { service, discoverShortsChannels, topResources, countSince, getFeaturedChannels, listForFeaturedCheck, markFeaturedChecked, enqueue };
}

describe("LibraryGrowthService", () => {
  it("grows the niches the library is thinnest on, skipping ones searched recently", async () => {
    const { service, topResources } = setup({
      counts: { "clash-royale": 40, "geometry-dash": 2, sourdough: 0 },
      recent: ["Pottery"],
    });
    expect((await service.plan(NOW)).map((s) => s.seed)).toEqual(["sourdough", "geometry dash", "clash royale"]);
    expect(topResources).toHaveBeenCalledWith(LIBRARY_GROWTH_EVENT, new Date("2026-09-02T12:00:00Z"), 1_000);
  });

  it("runs discovery as growth, which doesn't count against users' daily searches", async () => {
    const { service, discoverShortsChannels } = setup({ counts: { sourdough: 0, pottery: 1, "geometry-dash": 5, "clash-royale": 9 } });
    const result = await service.growOnce({ now: NOW });

    expect(discoverShortsChannels).toHaveBeenCalledTimes(3);
    expect(discoverShortsChannels).toHaveBeenNthCalledWith(1, "sourdough", null, NOW, { source: "growth", duration: "short" });
    expect(result).toEqual({ searched: ["sourdough", "pottery", "geometry dash"], channelsNew: 24, channelsQueued: 24, featuredChecked: 0, featuredQueued: 0 });
  });

  it("takes turns between Shorts and long-form searches, reseeding each on its own", async () => {
    const { service, discoverShortsChannels } = setup({
      seeds: ["sourdough", "pottery"],
      longFormSeeds: ["sourdough", "pottery"],
      counts: { sourdough: 0, pottery: 1 },
      recent: ["sourdough [long]"],
    });
    expect(await service.plan(NOW)).toEqual([
      { seed: "sourdough", duration: "short" },
      { seed: "pottery", duration: "long" },
      { seed: "pottery", duration: "short" },
    ]);
    const result = await service.growOnce({ now: NOW });
    expect(discoverShortsChannels).toHaveBeenNthCalledWith(2, "pottery", null, NOW, { source: "growth", duration: "long" });
    expect(result.searched).toEqual(["sourdough", "pottery [long]", "pottery"]);
  });

  it("respects the daily cap across runs", async () => {
    const capped = setup({ usedToday: 12 });
    expect(await capped.service.growOnce({ now: NOW })).toMatchObject({ stoppedBy: "daily_cap", searched: [] });
    expect(capped.discoverShortsChannels).not.toHaveBeenCalled();

    const nearlyCapped = setup({ usedToday: 11 });
    await nearlyCapped.service.growOnce({ now: NOW });
    expect(nearlyCapped.discoverShortsChannels).toHaveBeenCalledTimes(1);
  });

  it("stops as soon as YouTube quota runs out, and skips seeds that fail for other reasons", async () => {
    const { service } = setup({
      discover: async (keyword) => {
        if (keyword === "clash royale") throw new Error("storage full");
        if (keyword === "sourdough") throw new QuotaUnavailableError("background", NOW, "lane");
        return { keyword, channelsFound: 3, channelsNew: 2, channelsQueued: 2, alreadyFresh: 0, searchesLeftToday: 0, searchPasses: 1 };
      },
    });
    expect(await service.growOnce({ now: NOW })).toEqual({ searched: ["geometry dash"], channelsNew: 2, channelsQueued: 2, stoppedBy: "quota", featuredChecked: 0, featuredQueued: 0 });
  });

  it("follows the channels creators feature, queueing only creators we don't have", async () => {
    const A = "UCaaaaaaaaaaaaaaaaaaaaaa";
    const B = "UCbbbbbbbbbbbbbbbbbbbbbb";
    const { service, enqueue, markFeaturedChecked, listForFeaturedCheck } = setup({
      config: { searchesPerRun: 0 },
      sources: [
        { id: "src-1", youtube_channel_id: "UCsource1xxxxxxxxxxxxxxx" },
        { id: "src-2", youtube_channel_id: "UCsource2xxxxxxxxxxxxxxx" },
      ],
      featured: { UCsource1xxxxxxxxxxxxxxx: [A, B], UCsource2xxxxxxxxxxxxxxx: [] },
      known: [B],
    });
    const result = await service.growOnce({ now: NOW });

    expect(listForFeaturedCheck).toHaveBeenCalledWith(10, 1_000_000);
    expect(result).toMatchObject({ featuredChecked: 2, featuredQueued: 1 });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith("channel.refresh", { channelId: A, light: true }, { idempotencyKey: `channel.refresh:${A}:2026-09-16`, priority: 3 });
    expect(markFeaturedChecked).toHaveBeenCalledWith(["src-1", "src-2"], NOW);
  });

  it("caps new creators per run, and stops everything when quota runs out", async () => {
    const ids = Array.from({ length: 6 }, (_, i) => `UC${String(i).repeat(22)}`);
    const capped = setup({
      config: { searchesPerRun: 0, featuredNewPerRun: 4 },
      sources: [{ id: "src-1", youtube_channel_id: "UCsource1xxxxxxxxxxxxxxx" }, { id: "src-2", youtube_channel_id: "UCsource2xxxxxxxxxxxxxxx" }],
      featured: { UCsource1xxxxxxxxxxxxxxx: ids },
    });
    expect(await capped.service.growOnce({ now: NOW })).toMatchObject({ featuredChecked: 1, featuredQueued: 4 });

    const outOfQuota = setup({
      sources: [{ id: "src-1", youtube_channel_id: "UCsource1xxxxxxxxxxxxxxx" }, { id: "src-2", youtube_channel_id: "UCsource2xxxxxxxxxxxxxxx" }],
      featured: { UCsource1xxxxxxxxxxxxxxx: new QuotaUnavailableError("background", NOW, "lane") },
    });
    expect(await outOfQuota.service.growOnce({ now: NOW })).toMatchObject({ stoppedBy: "quota", featuredChecked: 0, searched: ["clash royale", "geometry dash", "sourdough"] });
    expect(outOfQuota.getFeaturedChannels).toHaveBeenCalledTimes(1);
    expect(outOfQuota.markFeaturedChecked).toHaveBeenCalledWith([], NOW);
  });

  it("searches before following featured channels, and skips featured once quota is gone", async () => {
    const order: string[] = [];
    const { service, getFeaturedChannels } = setup({
      sources: [{ id: "src-1", youtube_channel_id: "UCsource1xxxxxxxxxxxxxxx" }],
      discover: async (keyword) => {
        order.push(keyword);
        if (keyword === "geometry dash") throw new QuotaUnavailableError("background", NOW, "lane");
        return { keyword, channelsFound: 1, channelsNew: 1, channelsQueued: 1, alreadyFresh: 0, searchesLeftToday: 0, searchPasses: 1 };
      },
    });
    expect(await service.growOnce({ now: NOW })).toMatchObject({ stoppedBy: "quota", searched: ["clash royale"], featuredChecked: 0 });
    expect(order).toEqual(["clash royale", "geometry dash"]);
    // Featured lookups cost quota too: none once it's gone.
    expect(getFeaturedChannels).not.toHaveBeenCalled();
  });

  it("still follows featured channels when the day's searches are used up", async () => {
    const { service } = setup({ usedToday: 12, sources: [{ id: "src-1", youtube_channel_id: "UCsource1xxxxxxxxxxxxxxx" }], featured: { UCsource1xxxxxxxxxxxxxxx: ["UCnewxxxxxxxxxxxxxxxxxxx"] } });
    expect(await service.growOnce({ now: NOW })).toMatchObject({ stoppedBy: "daily_cap", featuredChecked: 1, featuredQueued: 1 });
  });

  it("follows featured channels on their own, without searching", async () => {
    const { service, discoverShortsChannels } = setup({ sources: [{ id: "src-1", youtube_channel_id: "UCsource1xxxxxxxxxxxxxxx" }], featured: { UCsource1xxxxxxxxxxxxxxx: ["UCnewxxxxxxxxxxxxxxxxxxx"] } });
    expect(await service.followOnce({ now: NOW })).toEqual({ featuredChecked: 1, featuredQueued: 1 });
    expect(discoverShortsChannels).not.toHaveBeenCalled();
  });

  it("doesn't retry channels whose featured list can't be read", async () => {
    const { service, markFeaturedChecked } = setup({
      config: { searchesPerRun: 0 },
      sources: [{ id: "gone", youtube_channel_id: "UCgonexxxxxxxxxxxxxxxxxx" }],
      featured: { UCgonexxxxxxxxxxxxxxxxxx: new Error("channel not found") },
    });
    expect(await service.growOnce({ now: NOW })).toMatchObject({ featuredChecked: 1, featuredQueued: 0 });
    expect(markFeaturedChecked).toHaveBeenCalledWith(["gone"], NOW);
  });

  it("reports when every seed was searched recently", async () => {
    const { service } = setup({ seeds: ["pottery"], recent: ["pottery"] });
    expect(await service.growOnce({ now: NOW })).toMatchObject({ stoppedBy: "no_seeds" });
  });
});
