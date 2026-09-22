import { describe, expect, it, vi } from "vitest";
import { isAppError } from "@/lib/core/errors";
import { scriptUserPrompt } from "@/lib/scripts/prompt";
import { ScriptService } from "@/lib/services/script-service";
import type { NicheMetrics } from "@/lib/niches/analysis";

const breakout = (id: string, title: string, multiplier: number) => ({
  youtube_video_id: id,
  title,
  channel_title: "Some Channel",
  view_count: 900_000,
  multiplier,
  format: "short",
  published_at: "2026-09-01T00:00:00Z",
});

const metrics = (breakouts: ReturnType<typeof breakout>[]) => ({ breakouts }) as unknown as NicheMetrics;

const script = {
  hook: "this cost me four hundred quid to learn",
  hookReason: "opens on the price, not the topic",
  beats: [
    { say: "first mistake", onScreen: "£400", visual: "hands holding the broken part", seconds: 4 },
    { say: "here's what to do instead", onScreen: "", visual: "the fix, close up", seconds: 6 },
  ],
  ending: "the second one is worse",
  titles: ["The £400 mistake", "Don't do this"],
  caption: "",
  whyItWorks: "takes the cost-first opening the examples share",
};

function serviceWith(deps: Record<string, unknown> = {}) {
  const generateObject = vi.fn().mockResolvedValue({ object: script, model: "gemini-test", usage: { inputTokens: 0, outputTokens: 0 } });
  const service = new ScriptService({
    ai: { name: "test", generateText: vi.fn(), generateObject } as never,
    transcripts: { forVideos: async () => new Map(), get: async () => null, save: vi.fn().mockResolvedValue(undefined), missing: async () => [] } as never,
    videos: { idsByYouTubeIds: async () => new Map() } as never,
    metricsFor: async () => metrics([breakout("vid00000001", "I broke it", 4.2)]),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    ...deps,
  });
  return { service, generateObject };
}

describe("ScriptService", () => {
  it("adds up the spoken seconds so the caller doesn't have to", async () => {
    const { service } = serviceWith();
    const result = await service.write({ topic: "car detailing", idea: "the mistake that cost me" });
    expect(result.seconds).toBe(10);
    expect(result.model).toBe("gemini-test");
  });

  it("shows the writer the niche's real outliers", async () => {
    const { service, generateObject } = serviceWith();
    await service.write({ topic: "car detailing", idea: "an idea" });
    const prompt = generateObject.mock.calls[0]![0].messages[0].content as string;
    expect(prompt).toContain("I broke it");
    expect(prompt).toContain("4.2x");
  });

  it("still writes when the niche has nothing measured yet", async () => {
    const { service, generateObject } = serviceWith({ metricsFor: async () => null });
    const result = await service.write({ topic: "brand new thing", idea: "an idea" });
    expect(result.sources).toEqual([]);
    expect(generateObject.mock.calls[0]![0].messages[0].content).toContain("No measured examples");
  });

  it("writes anyway when a niche report can't be built", async () => {
    const { service } = serviceWith({
      metricsFor: async () => {
        throw new Error("youtube is down");
      },
    });
    await expect(service.write({ topic: "x", idea: "y" })).resolves.toMatchObject({ sources: [] });
  });

  it("uses an opening the scraper already stored", async () => {
    const { service, generateObject } = serviceWith({
      videos: { idsByYouTubeIds: async () => new Map([["vid00000001", "internal-1"]]) },
      transcripts: {
        forVideos: async () => new Map([["internal-1", { video_id: "internal-1", opening: "watch what happens" }]]),
        get: async () => null,
        save: vi.fn(),
        missing: async () => [],
      },
    });

    await service.write({ topic: "car detailing", idea: "an idea" });
    expect(generateObject.mock.calls[0]![0].messages[0].content).toContain("watch what happens");
  });

  it("never fetches a transcript itself, however long the writer waits", async () => {
    // Reading one costs a scrape slot and takes longer than everything else in
    // the request put together; the scraper fills the table in the background.
    const save = vi.fn();
    const { service } = serviceWith({
      videos: { idsByYouTubeIds: async () => new Map([["vid00000001", "internal-1"]]) },
      transcripts: { forVideos: async () => new Map(), get: async () => null, save, missing: async () => [] },
    });

    const result = await service.write({ topic: "car detailing", idea: "an idea" });
    expect(result.sources[0]!.opening).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it("asks for a niche and an idea", async () => {
    const { service } = serviceWith();
    await expect(service.write({ topic: "  ", idea: "something" })).rejects.toThrow(/niche/i);
    await expect(service.write({ topic: "cars", idea: " " })).rejects.toThrow(/about/i);
  });

  it("says so plainly when no AI provider is configured", async () => {
    const { service } = serviceWith({ ai: null });
    const error = await service.write({ topic: "cars", idea: "an idea" }).catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("CONFIG_ERROR");
  });
});

describe("script prompt", () => {
  it("scales the word budget to the requested length", () => {
    const short = scriptUserPrompt({ topic: "t", idea: "i", targetSeconds: 15 }, []);
    const long = scriptUserPrompt({ topic: "t", idea: "i", targetSeconds: 60 }, []);
    expect(short).toContain("15 seconds");
    expect(short).toContain("33 words");
    expect(long).toContain("132 words");
  });

  it("passes on the creator's own angle, which is what stops it being generic", () => {
    const prompt = scriptUserPrompt({ topic: "t", idea: "i", angle: "I've detailed 400 cars" }, []);
    expect(prompt).toContain("I've detailed 400 cars");
  });
});
