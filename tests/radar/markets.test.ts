import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/lib/core/logger";
import { translatePhrases } from "@/lib/radar/markets";
import { scoreRadar } from "@/lib/radar/score";
import type { Supply } from "@/lib/radar/supply";
import { NicheRadarService } from "@/lib/services/niche-radar-service";
import type { YouTubeChannel, YouTubeSearchResult, YouTubeVideo } from "@/types/youtube";
import { memoryRadar } from "./memory-radar";

const NOW = new Date("2026-10-07T00:00:00Z");

const translator = () => ({
  generateObject: vi.fn(async ({ messages }: { messages: { content: string }[] }) => ({
    object: {
      phrases: messages[0]!.content.split("\n").map((english) => ({
        english,
        de: english === "roth ira for beginners" ? "ETF-Sparplan für Anfänger" : `${english} de`,
        ja: `${english} ja`,
        fr: `${english} fr`,
        es: `${english} es`,
        // Same as the English: the same search, so it's dropped.
        pt: english,
      })),
    },
    model: "test",
    usage: { inputTokens: 0, outputTokens: 0 },
  })),
});

const supply = (over: Partial<Supply> = {}): Supply => ({
  results: 20,
  recentShare: 0.1,
  medianAgeDays: 500,
  medianViews: 40_000,
  smallWins: 3,
  bigShare: 0,
  shortsShare: 0,
  medianMinutes: 10,
  top: [],
  gap: 0.8,
  ...over,
});

describe("other-language markets", () => {
  it("translates phrases into each market, dropping ones that didn't change", async () => {
    const out = await translatePhrases(translator() as never, ["roth ira for beginners"]);
    expect(out.map((t) => t.market)).toEqual(["de", "ja", "fr", "es"]);
    expect(out[0]).toEqual({ english: "roth ira for beginners", market: "de", phrase: "etf-sparplan für anfänger" });
  });

  it("pays a market's share of English RPM", () => {
    const base = { keyword: "roth ira for beginners", depth: 1, suggestRank: 0, category: "Finance & Business" as const, supply: supply(), demand: null, ease: null };
    const en = scoreRadar(base)!;
    const pt = scoreRadar({ ...base, rpmFactor: 0.3 })!;
    expect(pt.rpm[0]).toBeCloseTo(en.rpm[0] * 0.3);
    expect(pt.parts.pay).toBeLessThan(en.parts.pay);
  });

  it("translates the best English phrases once a day and reads them in their own market", async () => {
    const radar = memoryRadar();
    await radar.addKeywords([{ keyword: "roth ira for beginners", seed: "roth ira", depth: 1, category: "Finance & Business" }]);
    radar.rows.get("roth ira for beginners")!.score = 70;
    const ai = translator();
    const search = vi.fn(async (q: string, market: string) => [{ kind: "video", id: `${market}-${q.length}` }] as YouTubeSearchResult[]);
    const youtube = {
      getVideos: vi.fn(async (ids: readonly string[]) =>
        ids.map((id) => ({ id, channelId: "c", channelTitle: "C", title: "t", publishedAt: "2025-01-01T00:00:00Z", durationSeconds: 600, statistics: { viewCount: 30_000, likeCount: null, commentCount: null } }) as YouTubeVideo),
      ),
      getChannels: vi.fn(async () => [{ id: "c", statistics: { subscriberCount: 2_000, hiddenSubscriberCount: false } }] as YouTubeChannel[]),
    };
    const service = new NicheRadarService({ radar, seeds: [], ai: ai as never, search, youtube }, {}, createLogger());

    expect(await service.translateOnce({ now: NOW })).toEqual({ phrases: 1, added: 4 });
    expect(radar.rows.get("etf-sparplan für anfänger")).toMatchObject({ market: "de", source: "translation", seed: "roth ira for beginners", depth: 2, category: "Finance & Business" });
    // Not again the same day, and never the same phrase twice.
    expect(await service.translateOnce({ now: new Date(NOW.getTime() + 3_600_000) })).toBeNull();
    expect(await service.translateOnce({ now: new Date(NOW.getTime() + 2 * 86_400_000) })).toBeNull();
    expect(ai.generateObject).toHaveBeenCalledTimes(1);

    await service.checkSupplyOnce({ limit: 10, now: NOW });
    expect(search).toHaveBeenCalledWith("etf-sparplan für anfänger", "de");
    expect(search).toHaveBeenCalledWith("roth ira for beginners", "en");

    const [german] = (await service.list()).filter((n) => n.market === "de");
    expect(german).toMatchObject({ seed: "roth ira for beginners", market: "de" });
    // German pays most of English: $8-$20 becomes $6.80-$17.
    expect(german!.rpm).toEqual([6.8, 17]);
    // The library only grows through English phrases.
    expect(await service.growthSeeds(10)).not.toContain("etf-sparplan für anfänger");
  });
});
