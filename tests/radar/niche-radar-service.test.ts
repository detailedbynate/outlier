import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/lib/core/logger";
import { NicheRadarService } from "@/lib/services/niche-radar-service";
import type { YouTubeChannel, YouTubeSearchResult, YouTubeVideo } from "@/types/youtube";
import { memoryRadar } from "./memory-radar";

const NOW = new Date("2026-10-07T00:00:00Z");

function fakeYouTube() {
  const videos = (ids: readonly string[]) =>
    ids.map((id, i) => ({
      id,
      channelId: `ch${i}`,
      channelTitle: `Channel ${i}`,
      title: `How I ${id} on a budget`,
      publishedAt: new Date(NOW.getTime() - 400 * 86_400_000).toISOString(),
      durationSeconds: 540,
      statistics: { viewCount: 60_000, likeCount: null, commentCount: null },
    })) as YouTubeVideo[];
  return {
    getVideos: vi.fn(async (ids: readonly string[]) => videos(ids)),
    getChannels: vi.fn(async (ids: readonly string[]) => ids.map((id) => ({ id, statistics: { subscriberCount: 4_000, hiddenSubscriberCount: false } }) as YouTubeChannel)),
  };
}

describe("NicheRadarService", () => {
  it("grows seeds through autocomplete, reads supply, rates ease, and ranks", async () => {
    const radar = memoryRadar();
    const suggest = vi.fn(async (q: string) => (q === "budgeting" ? [{ phrase: "budgeting for beginners", rank: 0 }, { phrase: "budgeting app", rank: 1 }, { phrase: "budgeting", rank: 2 }] : []));
    const search = vi.fn(async (q: string) => [1, 2, 3].map((i) => ({ kind: "video", id: `${q.replace(/\s/g, "-")}-${i}` }) as YouTubeSearchResult));
    const ai = {
      generateObject: vi.fn(async ({ messages }: { messages: { content: string }[] }) => ({
        object: {
          niches: [...messages[0]!.content.matchAll(/Niche: ([^(\n]+)/g)].map((m) => ({
            keyword: m[1]!.trim(),
            ease: 92,
            faceless: true,
            production: ["voiceover", "screen recording"],
            how: "Screen-record the app and talk over it.",
            ideas: ["a", "b", "c", "d"],
          })),
        },
        model: "test",
        usage: { inputTokens: 0, outputTokens: 0 },
      })),
    };
    const service = new NicheRadarService({ radar, seeds: ["Budgeting"], suggest, search, youtube: fakeYouTube(), ai: ai as never }, {}, createLogger());

    expect(await service.seed()).toBe(1);
    expect(await service.seed()).toBe(0);

    const grown = await service.expandOnce({ maxQueries: 100, now: NOW });
    expect(grown).toMatchObject({ queries: 32, added: 2, expanded: 1 });
    expect(radar.rows.get("budgeting for beginners")).toMatchObject({ depth: 1, seed: "budgeting", suggest_rank: 0, category: "Finance & Business" });

    const supply = await service.checkSupplyOnce({ limit: 10, now: NOW });
    expect(supply).toEqual({ checked: 3, empty: 0 });
    expect(radar.rows.get("budgeting app")!.score).not.toBeNull();

    expect(await service.rateEaseOnce({ limit: 10, now: NOW })).toEqual({ rated: 3 });
    const list = await service.list();
    expect(list).toHaveLength(3);
    expect(list[0]!.ease).toMatchObject({ ease: 92, faceless: true });
    expect(list[0]!.ease!.ideas).toHaveLength(3);
    expect(list[0]!.supply.smallWins).toBe(3);
  });

  it("doesn't start a phrase the round's budget can't cover", async () => {
    const radar = memoryRadar();
    const suggest = vi.fn(async () => []);
    const service = new NicheRadarService({ radar, seeds: ["a b", "c d"], suggest }, {}, createLogger());
    await service.seed();
    expect(await service.expandOnce({ maxQueries: 40, now: NOW })).toMatchObject({ queries: 32, expanded: 1 });
  });

  it("sweeps a seed again a week later and marks what's new as rising, checked first", async () => {
    const radar = memoryRadar();
    let week = 1;
    const suggest = vi.fn(async (q: string) =>
      q === "roth ira" ? [{ phrase: "roth ira explained", rank: 0 }, ...(week === 2 ? [{ phrase: "roth ira new limits", rank: 1 }] : [])] : [],
    );
    const service = new NicheRadarService({ radar, seeds: ["roth ira"], suggest, search: async () => [], youtube: fakeYouTube() }, {}, createLogger());
    await service.seed();
    expect(await service.expandOnce({ maxQueries: 40, now: NOW })).toMatchObject({ added: 1, rising: 0 });
    // Within the week the seed isn't swept again.
    expect(await service.expandOnce({ maxQueries: 40, now: new Date(NOW.getTime() + 3 * 86_400_000) })).toMatchObject({ rising: 0 });

    week = 2;
    const later = new Date(NOW.getTime() + 8 * 86_400_000);
    expect(await service.expandOnce({ maxQueries: 40, now: later })).toMatchObject({ expanded: 1, added: 1, rising: 1 });
    expect(radar.rows.get("roth ira new limits")).toMatchObject({ source: "rising", depth: 1 });
    // The phrase from the first sweep keeps its source.
    expect(radar.rows.get("roth ira explained")!.source).toBe("autocomplete");
    const next = await radar.dueForSupply(later, 1);
    expect(next[0]!.keyword).toBe("roth ira new limits");
  });

  it("adds library niches as seeds, once each", async () => {
    const radar = memoryRadar();
    const service = new NicheRadarService({ radar, seeds: [] }, {}, createLogger());
    expect(await service.addSeeds(["Roblox Horror", "roblox horror", "ai"], "library")).toBe(1);
    expect(radar.rows.get("roblox horror")).toMatchObject({ depth: 0, source: "library" });
    expect(await service.addSeeds(["roblox horror"], "library")).toBe(0);
  });

  it("only asks for demand with a full request, at most once a day", async () => {
    const radar = memoryRadar();
    const searchVolume = vi.fn(async (keywords: readonly string[]) => new Map(keywords.map((k) => [k, { volume: 100, cpc: 1, competition: 10, trend: null, peakMonth: null, source: "dataforseo" as const }])));
    const service = new NicheRadarService({ radar, seeds: [], demand: { searchVolume } }, { demandMinBatch: 3 }, createLogger());
    // No YouTube check needed first: volume decides which phrases get one.
    const phrase = (keyword: string, market = "en") => radar.addKeywords([{ keyword, seed: keyword, market }]);
    await phrase("roth ira");
    await phrase("roth ira steuern", "de");
    await phrase("hsa explained");
    // Two English phrases due: a request would be half empty.
    expect(await service.enrichDemandOnce({ now: NOW })).toEqual({ enriched: 0 });
    expect(searchVolume).not.toHaveBeenCalled();

    await phrase("ira vs 401k");
    expect(await service.enrichDemandOnce({ now: NOW })).toEqual({ enriched: 3 });
    expect(searchVolume.mock.calls[0]![0]).not.toContain("roth ira steuern");

    await Promise.all(["a b c", "d e f", "g h i"].map((k) => phrase(k)));
    const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);
    expect(await service.enrichDemandOnce({ now: hours(12) })).toEqual({ enriched: 0 });
    // A restart (a fresh service) still keeps the pace, from the saved check times.
    const restarted = new NicheRadarService({ radar, seeds: [], demand: { searchVolume } }, { demandMinBatch: 3 }, createLogger());
    expect(await restarted.enrichDemandOnce({ now: hours(12) })).toEqual({ enriched: 0 });
    expect(await restarted.enrichDemandOnce({ now: hours(25) })).toEqual({ enriched: 3 });
    expect(searchVolume).toHaveBeenCalledTimes(2);
  });

  it("stops paying for volume at the budget, and checks searched phrases on YouTube first", async () => {
    const radar = memoryRadar();
    const searchVolume = vi.fn(async (keywords: readonly string[]) =>
      new Map(keywords.map((k) => [k, { volume: k === "popular thing" ? 50_000 : 0, cpc: 1, competition: 10, trend: null, peakMonth: null, source: "dataforseo" as const }])),
    );
    const service = new NicheRadarService({ radar, seeds: [], demand: { searchVolume } }, { demandMinBatch: 2, demandBudgetPhrases: 2 }, createLogger());
    await radar.addKeywords([
      { keyword: "nobody searches this", seed: "x", market: "en", depth: 1, priority: 90 },
      { keyword: "popular thing", seed: "x", market: "en", depth: 1, priority: 10 },
    ]);
    expect(await service.enrichDemandOnce({ now: NOW })).toEqual({ enriched: 2 });
    expect(radar.rows.get("popular thing")!.priority).toBeGreaterThan(radar.rows.get("nobody searches this")!.priority!);

    await radar.addKeywords([
      { keyword: "later one", seed: "x", market: "en" },
      { keyword: "later two", seed: "x", market: "en" },
    ]);
    expect(await service.enrichDemandOnce({ now: new Date(NOW.getTime() + 2 * 86_400_000) })).toEqual({ enriched: 0 });
    expect(searchVolume).toHaveBeenCalledTimes(1);
  });

  it("turns rising games into seeds and ideas, once a day", async () => {
    const radar = memoryRadar();
    const games = vi.fn(async () => [
      { platform: "roblox" as const, name: "Huss Valley", url: "https://www.roblox.com/games/8", players: 88_000, reason: "up-and-coming" as const, rank: null, lastWeekRank: null },
      { platform: "steam" as const, name: "Ready or Not", url: "https://store.steampowered.com/app/2", players: 40_000, reason: "climbing" as const, rank: 20, lastWeekRank: 45 },
    ]);
    const service = new NicheRadarService({ radar, seeds: [], games }, {}, createLogger());
    expect(await service.collectGamesOnce({ now: NOW })).toEqual({ games: 2, seeds: 2 });
    expect(radar.rows.get("huss valley roblox")).toMatchObject({ source: "game", depth: 0, category: "Gaming" });
    expect(radar.ideaRows.find((r) => r.title === "Ready or Not")).toMatchObject({ source: "games", kind: "climbing", comments: 25, score: 40_000 });
    expect(await service.collectGamesOnce({ now: new Date(NOW.getTime() + 3_600_000) })).toBeNull();
    expect(games).toHaveBeenCalledTimes(1);

    // Once YouTube has been checked for a game, it shows with its gap.
    const listed = await service.risingGames({ now: NOW });
    expect(listed.map((g) => [g.game.title, g.phrase, g.niche])).toEqual([
      ["Huss Valley", "huss valley roblox", null],
      ["Ready or Not", "ready or not", null],
    ]);
  });

  it("does nothing without its scraping half", async () => {
    const service = new NicheRadarService({ radar: memoryRadar(), seeds: [] }, {}, createLogger());
    expect(await service.expandOnce({ maxQueries: 10 })).toEqual({ queries: 0, added: 0, expanded: 0, rising: 0 });
    expect(await service.checkSupplyOnce({ limit: 5 })).toEqual({ checked: 0, empty: 0 });
    expect(await service.collectRedditOnce()).toBeNull();
    expect(await service.enrichDemandOnce()).toEqual({ enriched: 0 });
  });
});
