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

  it("does nothing without its scraping half", async () => {
    const service = new NicheRadarService({ radar: memoryRadar(), seeds: [] }, {}, createLogger());
    expect(await service.expandOnce({ maxQueries: 10 })).toEqual({ queries: 0, added: 0, expanded: 0 });
    expect(await service.checkSupplyOnce({ limit: 5 })).toEqual({ checked: 0, empty: 0 });
    expect(await service.collectRedditOnce()).toBeNull();
    expect(await service.enrichDemandOnce()).toEqual({ enriched: 0 });
  });
});
