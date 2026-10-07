import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/lib/core/logger";
import type { VideoComment } from "@/lib/innertube/comments";
import { extractRequests, isRequestLike } from "@/lib/radar/requests";
import { NicheRadarService } from "@/lib/services/niche-radar-service";
import type { Json } from "@/types/database";
import { memoryRadar } from "./memory-radar";

const NOW = new Date("2026-10-07T00:00:00Z");

const comment = (id: string, text: string, likes: number, videoId = "v1"): VideoComment => ({ id, videoId, text, likes });

/** Answers with one request built from every comment it was shown. */
const extractor = () => ({
  generateObject: vi.fn(async ({ messages }: { messages: { content: string }[] }) => {
    const content = messages[0]!.content;
    const niche = /Niche: (.+)/.exec(content)![1]!;
    const numbers = [...content.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    return {
      object: { requests: [{ niche, title: "HSA vs FSA: which one to pick", comments: [...numbers, 99] }, { niche: "made up niche", title: "x", comments: [0] }] },
      model: "test",
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }),
});

describe("viewer requests", () => {
  it("only sends comments that could be asking for something", () => {
    expect(isRequestLike("Can you do a video on HSA vs FSA next?")).toBe(true);
    expect(isRequestLike("Would love a follow-up on backdoor roth")).toBe(true);
    expect(isRequestLike("Great video, thanks!")).toBe(false);
    expect(isRequestLike("please")).toBe(false);
  });

  it("turns asking comments into requests, linked to the most-liked one", async () => {
    const ai = extractor();
    const out = await extractRequests(ai as never, [
      {
        niche: "hsa explained",
        comments: [comment("a", "Can you make a video on HSA vs FSA?", 40), comment("b", "Great video!", 900), comment("c", "Please explain HSA vs FSA for families", 300, "v2")],
      },
      { niche: "quiet niche", comments: [comment("d", "Love this", 5)] },
    ]);
    // The praise never reaches the model, the quiet niche isn't sent, and invented niches or numbers are dropped.
    expect(ai.generateObject.mock.calls[0]![0].messages[0]!.content).not.toContain("Great video");
    expect(ai.generateObject.mock.calls[0]![0].messages[0]!.content).not.toContain("quiet niche");
    expect(out).toEqual([{ niche: "hsa explained", title: "HSA vs FSA: which one to pick", likes: 340, asks: 2, url: "https://www.youtube.com/watch?v=v2&lc=c" }]);
  });

  it("reads the best gaps' top videos once a day and saves the requests as ideas", async () => {
    const radar = memoryRadar();
    await radar.addKeywords([{ keyword: "hsa explained", seed: "hsa", depth: 1, category: "Finance & Business" }]);
    Object.assign(radar.rows.get("hsa explained")!, {
      score: 72,
      supply: { top: [{ id: "v1" }, { id: "v2" }, { id: "v3" }] } as unknown as Json,
    });
    const comments = vi.fn(async (videoId: string) => [comment(`${videoId}-1`, "Could you cover HSA vs FSA?", 50, videoId)]);
    const service = new NicheRadarService({ radar, seeds: [], comments, ai: extractor() as never }, {}, createLogger());

    expect(await service.collectRequestsOnce({ now: NOW })).toEqual({ niches: 1, requests: 1 });
    expect(comments.mock.calls.map(([id]) => id)).toEqual(["v1", "v2"]);
    expect(radar.ideaRows[0]).toMatchObject({ source: "comments", kind: "request", community: "hsa explained", score: 100, comments: 2, category: "Finance & Business" });
    expect(await service.collectRequestsOnce({ now: new Date(NOW.getTime() + 3_600_000) })).toBeNull();
  });
});
