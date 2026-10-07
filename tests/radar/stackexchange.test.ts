import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/lib/core/logger";
import { priorityOf } from "@/lib/radar/priority";
import { decodeEntities, parseQuestions, parseTags, StackExchangeClient } from "@/lib/radar/stackexchange";
import { NicheRadarService } from "@/lib/services/niche-radar-service";
import { memoryRadar } from "./memory-radar";

const NOW = new Date("2026-10-07T00:00:00Z");

describe("stack exchange", () => {
  it("decodes titles", () => {
    expect(decodeEntities("Can&#39;t I &amp; my spouse both claim &quot;head of household&quot;? &#x2014; &lt;US&gt;")).toBe(
      `Can't I & my spouse both claim "head of household"? — <US>`,
    );
  });

  it("keeps open questions with their views and skips closed ones", () => {
    const body = {
      items: [
        { title: "Is a Roth IRA worth it at 22?", link: "https://money.stackexchange.com/q/1", score: 40, view_count: 210_000, answer_count: 6, creation_date: 1_500_000_000 },
        { title: "Duplicate", link: "https://money.stackexchange.com/q/2", closed_date: 1_600_000_000 },
      ],
    };
    const [q, ...rest] = parseQuestions(body, "money");
    expect(rest).toHaveLength(0);
    expect(q).toMatchObject({ community: "money.stackexchange.com", views: 210_000, answers: 6, category: "Finance & Business" });
  });

  it("turns popular tags into seeds, without places, versions or housekeeping", () => {
    const body = {
      items: [
        { name: "united-states", count: 15_000 },
        { name: "roth-ira", count: 900 },
        { name: "windows-10", count: 5_000 },
        { name: "credit-score", count: 700 },
        { name: "untagged", count: 400 },
        { name: "tiny-tag", count: 20 },
      ],
    };
    expect(parseTags(body)).toEqual(["roth ira", "credit score"]);
    const singles = { items: ["taxes", "stocks", "mortgage", "water", "doors", "capital-gains"].map((name, i) => ({ name, count: 5_000 - i * 100 })) };
    expect(parseTags(singles, { singleWords: 3 })).toEqual(["taxes", "stocks", "mortgage", "capital gains"]);
  });

  it("honours backoff and stops the sweep when the quota runs out", async () => {
    const sleep = vi.fn(async (ms: number) => void ms);
    const responses = [
      { items: [{ title: "a?", link: "https://x/1" }], backoff: 10 },
      { items: [] },
      { items: [], quota_remaining: 2 },
    ];
    const fetch = vi.fn(async () => new Response(JSON.stringify(responses.shift() ?? { items: [] }), { status: 200 }));
    const client = new StackExchangeClient({ fetch: fetch as never, sleep, spacingMs: 0 });
    const { questions } = await client.sweep(["money", "law", "cooking"]);
    expect(questions).toHaveLength(1);
    // money: 2 requests; law: quota hit on the first, which ends the sweep before cooking.
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.some(([ms]) => ms > 9_000)).toBe(true);
  });

  it("collects once a day: questions as ideas, tags as seeds", async () => {
    const radar = memoryRadar();
    const stackexchange = {
      sweep: vi.fn(async () => ({
        questions: [{ community: "money.stackexchange.com", title: "Is a Roth IRA worth it?", url: "https://x/1", score: 40, views: 210_000, answers: 6, postedAt: NOW.toISOString(), category: "Finance & Business" as const }],
        tags: [{ site: "money", tags: ["roth ira", "credit score"] }],
      })),
    };
    const service = new NicheRadarService({ radar, seeds: [], stackexchange }, {}, createLogger());
    expect(await service.collectStackOnce({ now: NOW })).toEqual({ questions: 1, seeds: 2 });
    expect(radar.ideaRows[0]).toMatchObject({ source: "stackexchange", views: 210_000, kind: "question" });
    expect(radar.rows.get("credit score")).toMatchObject({ source: "stackexchange", depth: 0, category: "Finance & Business" });
    // Again within the day: nothing.
    radar.ideaRows[0]!.collected_at = NOW.toISOString();
    expect(await service.collectStackOnce({ now: new Date(NOW.getTime() + 3_600_000) })).toBeNull();
  });
});

describe("priority", () => {
  it("reads new searches and paying topics before the rest", () => {
    const base = { depth: 1, suggestRank: 3, category: null };
    const finance = priorityOf({ ...base, keyword: "roth ira for beginners", source: "autocomplete" });
    const gaming = priorityOf({ ...base, keyword: "minecraft seeds", category: "Gaming", source: "autocomplete" });
    const rising = priorityOf({ ...base, keyword: "minecraft seeds", category: "Gaming", source: "rising" });
    expect(finance).toBeGreaterThan(gaming);
    expect(rising).toBeGreaterThan(gaming);
  });
});
