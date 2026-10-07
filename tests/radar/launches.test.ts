import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/lib/core/logger";
import { fetchLaunches, launchPhrases, type Launch } from "@/lib/radar/launches";
import { NicheRadarService } from "@/lib/services/niche-radar-service";
import { memoryRadar } from "./memory-radar";

const NOW = new Date("2026-10-07T00:00:00Z");

const picker = () => ({
  generateObject: vi.fn(async () => ({
    object: {
      tools: [
        { name: "Photocraft", phrase: "Photocraft vs Photoshop", from: 1 },
        { name: "Dup", phrase: "photocraft vs photoshop", from: 1 },
        { name: "Ghost", phrase: "nothing", from: 0 },
        { name: "Missing", phrase: "missing tool tutorial", from: 9 },
      ],
    },
    model: "test",
    usage: { inputTokens: 0, outputTokens: 0 },
  })),
});

const launches: Launch[] = [
  { source: "hn", title: "A trash clock", description: "", url: "https://news.ycombinator.com/item?id=1", score: 230 },
  { source: "github", title: "photocraft", description: "Photoshop in the browser", url: "https://github.com/x/photocraft", score: 8_400 },
];

describe("new launches", () => {
  it("reads Show HN and rising GitHub repos, and survives one of them failing", async () => {
    const fetch = vi.fn(async (url: string | URL) => {
      if (String(url).includes("algolia")) return new Response(JSON.stringify({ hits: [{ title: "Show HN: Nightwatch – clear-sky alerts", objectID: "42", points: 85 }] }));
      throw new Error("rate limited");
    });
    const out = await fetchLaunches({ fetch: fetch as never, now: NOW });
    expect(out).toEqual([{ source: "hn", title: "Nightwatch – clear-sky alerts", description: "", url: "https://news.ycombinator.com/item?id=42", score: 85 }]);
    expect(String(fetch.mock.calls[0]![0])).toContain(`created_at_i>${Math.floor(NOW.getTime() / 1000) - 7 * 86_400}`);
  });

  it("keeps tutorial phrases with a launch behind them, once each", async () => {
    expect(await launchPhrases(picker() as never, launches)).toEqual([
      { name: "Photocraft", phrase: "photocraft vs photoshop", url: "https://github.com/x/photocraft", score: 8_400 },
    ]);
  });

  it("collects once a week: phrases to grow and ideas to show", async () => {
    const radar = memoryRadar();
    const service = new NicheRadarService({ radar, seeds: [], ai: picker() as never, launches: async () => launches }, {}, createLogger());
    expect(await service.collectLaunchesOnce({ now: NOW })).toEqual({ launches: 2, phrases: 1 });
    expect(radar.rows.get("photocraft vs photoshop")).toMatchObject({ source: "launch", depth: 1, category: "Science & Tech", seed: "photocraft" });
    expect(radar.ideaRows[0]).toMatchObject({ source: "launches", kind: "launch", title: "Photocraft", community: "photocraft vs photoshop", score: 8_400 });
    // Launch phrases grow through autocomplete like Reddit's do.
    expect((await radar.dueForExpansion(1, 10)).map((r) => r.keyword)).toContain("photocraft vs photoshop");
    expect(await service.collectLaunchesOnce({ now: new Date(NOW.getTime() + 86_400_000) })).toBeNull();
  });
});
