import { describe, expect, it, vi } from "vitest";
import { InnerTubeBlockedError, InnerTubeBusyError, InnerTubeGate } from "@/lib/innertube/gate";
import { durationFilter, InnerTubeSearch, SCRAPEABLE_ORDERS, uploadDateBucket } from "@/lib/innertube/search";
import { SearchFirstYouTubeService } from "@/lib/youtube/search-first";
import type { YouTubeClient } from "@/lib/youtube/client";
import type { Page, YouTubeSearchResult } from "@/types/youtube";

const NOW = new Date("2026-09-20T12:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

const result = (id: string): YouTubeSearchResult => ({
  kind: "video",
  id,
  channelId: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
  channelTitle: "Someone",
  title: "A video",
  description: "",
  publishedAt: null,
  thumbnailUrl: null,
  liveBroadcastContent: null,
});

/** The API side: a client whose search endpoint returns one known row. */
function apiClient() {
  return {
    get: vi.fn(async (endpoint: string) => {
      if (endpoint !== "search") throw new Error(`unexpected endpoint ${endpoint}`);
      return {
        items: [{ id: { kind: "youtube#video", videoId: "apiapiapia" }, snippet: { title: "From the API", channelId: "UC_x5XG1OV2P6uZZ5FSM9Ttw" } }],
        pageInfo: { totalResults: 1 },
      };
    }),
  } as unknown as YouTubeClient;
}

function build(scrapedSearch: () => Promise<YouTubeSearchResult[]>) {
  const client = apiClient();
  const scraped = { search: vi.fn(scrapedSearch) } as unknown as InnerTubeSearch;
  const service = new SearchFirstYouTubeService(client, scraped, { maxWaitMs: 50 });
  return { service, client, scraped };
}

const ids = (page: Page<YouTubeSearchResult>) => page.items.map((item) => item.id);

describe("uploadDateBucket", () => {
  it.each([
    [undefined, "all"],
    [ago(2), "today"],
    [ago(30), "week"],
    [ago(24 * 10), "month"],
    [ago(24 * 200), "year"],
    [ago(24 * 500), "all"],
    ["not a date", "all"],
  ])("%s → %s", (input, expected) => {
    expect(uploadDateBucket(input, NOW)).toBe(expected);
  });
});

describe("durationFilter", () => {
  it.each([
    ["short", "under_three_mins"],
    ["medium", "three_to_twenty_mins"],
    ["long", "over_twenty_mins"],
    ["any", "all"],
    [undefined, "all"],
  ])("%s → %s", (input, expected) => {
    expect(durationFilter(input)).toBe(expected);
  });
});

describe("SearchFirstYouTubeService", () => {
  it("answers from scraped results, spending no quota", async () => {
    const { service, client, scraped } = build(async () => [result("aaaaaaaaaaa"), result("bbbbbbbbbbb")]);
    const page = await service.search({ q: "faceless automation", type: "video" });
    expect(ids(page)).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb"]);
    expect(client.get).not.toHaveBeenCalled();
    // Interactive: it must not wait behind the scraper's queue.
    expect(scraped.search).toHaveBeenCalledWith(expect.objectContaining({ q: "faceless automation" }), { lane: "user", maxWaitMs: 50 });
  });

  it("uses the API when the gate is busy", async () => {
    const { service, client } = build(async () => {
      throw new InnerTubeBusyError(9_000);
    });
    expect(ids(await service.search({ q: "cars", type: "video" }))).toEqual(["apiapiapia"]);
    expect(client.get).toHaveBeenCalledOnce();
  });

  it("uses the API while the breaker is open", async () => {
    const { service, client } = build(async () => {
      throw new InnerTubeBlockedError("captcha");
    });
    expect(ids(await service.search({ q: "cars", type: "video" }))).toEqual(["apiapiapia"]);
    expect(client.get).toHaveBeenCalledOnce();
  });

  it("uses the API when a scrape breaks or returns nothing", async () => {
    const broken = build(async () => {
      throw new Error("parse error");
    });
    expect(ids(await broken.service.search({ q: "cars", type: "video" }))).toEqual(["apiapiapia"]);

    const empty = build(async () => []);
    expect(ids(await empty.service.search({ q: "cars", type: "video" }))).toEqual(["apiapiapia"]);
  });

  it.each([
    ["a page token", { q: "cars", pageToken: "CAUQAA" }],
    ["a channel-scoped search", { q: "cars", channelId: "UC_x5XG1OV2P6uZZ5FSM9Ttw" }],
    ["playlists", { q: "cars", type: "playlist" as const }],
    ["the date order", { q: "cars", order: "date" as const }],
    ["a category filter", { q: "cars", videoCategoryId: "20" }],
  ])("leaves %s to the API", async (_label, params) => {
    const { service, client, scraped } = build(async () => [result("aaaaaaaaaaa")]);
    await service.search(params);
    expect(scraped.search).not.toHaveBeenCalled();
    expect(client.get).toHaveBeenCalledOnce();
  });

  it("only claims the orders the web search can actually do", () => {
    expect([...SCRAPEABLE_ORDERS].sort()).toEqual(["rating", "relevance", "viewCount"]);
  });

  it("rejects invalid parameters before reaching either side", async () => {
    const { service, client, scraped } = build(async () => []);
    await expect(service.search({ q: "", type: "video" })).rejects.toThrow(/Invalid search parameters/);
    expect(client.get).not.toHaveBeenCalled();
    expect(scraped.search).not.toHaveBeenCalled();
  });
});

describe("InnerTubeSearch paging", () => {
  /** A fake InnerTube whose first page has a continuation, mimicking a real result page. */
  function fakeYouTube(pages: number, onContinuation?: () => never) {
    let page = 0;
    const build = (): unknown => {
      page += 1;
      const results = Array.from({ length: 20 }, (_, i) => ({ type: "Video", video_id: `v${page}${String(i).padStart(9, "0")}`, title: `Result ${page}.${i}` }));
      return {
        results,
        has_continuation: page < pages,
        getContinuation: async () => {
          onContinuation?.();
          return build();
        },
      };
    };
    return { search: async () => build() };
  }

  const searchWith = (yt: unknown) => {
    const search = new InnerTubeSearch(new InnerTubeGate({ requestsPerMinute: 6_000, userRequestsPerMinute: 6_000 }));
    // The session is created lazily; stand in for it.
    (search as unknown as { client: Promise<unknown> }).client = Promise.resolve(yt);
    return search;
  };

  it("follows continuations to fill the requested count", async () => {
    const results = await searchWith(fakeYouTube(3)).search({ q: "cars", type: "video", maxResults: 50 });
    expect(results).toHaveLength(50);
  });

  it("stops at one page when that is enough", async () => {
    const results = await searchWith(fakeYouTube(3)).search({ q: "cars", type: "video", maxResults: 10 });
    expect(results).toHaveLength(10);
  });

  it("keeps the results it has when a follow-up page is refused", async () => {
    const yt = fakeYouTube(3, () => {
      throw new InnerTubeBusyError(9_000);
    });
    // The whole search used to be thrown away here, and the caller paid 100 units for it.
    const results = await searchWith(yt).search({ q: "cars", type: "video", maxResults: 50 }, { lane: "user", maxWaitMs: 100 });
    expect(results).toHaveLength(20);
  });
});

describe("gate lanes", () => {
  const clock = () => {
    let time = 1_000_000;
    return { now: () => time, sleep: async (ms: number) => { time += ms; }, advance: (ms: number) => { time += ms; } };
  };

  it("gives interactive reads their own allowance, so they don't wait on the scraper", async () => {
    const c = clock();
    const sleeps: number[] = [];
    const gate = new InnerTubeGate(
      { requestsPerMinute: 1, userRequestsPerMinute: 60 },
      { now: c.now, sleep: async (ms) => { sleeps.push(ms); c.advance(ms); }, random: () => 0.5 },
    );
    await gate.run({ label: "bg1" }, async () => 1);
    await gate.run({ label: "bg2" }, async () => 2);
    await gate.run({ label: "user", lane: "user" }, async () => 3);
    // The second background read waited a full minute; the user read didn't wait at all.
    expect(sleeps).toEqual([60_000]);
  });

  it("refuses rather than making an interactive read queue", async () => {
    const c = clock();
    const gate = new InnerTubeGate({ userRequestsPerMinute: 1 }, { now: c.now, sleep: c.sleep, random: () => 0.5 });
    await gate.run({ label: "first", lane: "user", maxWaitMs: 2_000 }, async () => 1);
    await expect(gate.run({ label: "second", lane: "user", maxWaitMs: 2_000 }, async () => 2)).rejects.toThrow(InnerTubeBusyError);
    // Waiting out the gap makes it available again.
    c.advance(60_000);
    await expect(gate.run({ label: "third", lane: "user", maxWaitMs: 2_000 }, async () => 3)).resolves.toBe(3);
  });

  it("serves queued user reads before queued background ones", async () => {
    const order: string[] = [];
    const gate = new InnerTubeGate({ requestsPerMinute: 6_000, userRequestsPerMinute: 6_000, maxConcurrent: 1 });
    let release: (() => void) | null = null;
    const blocker = gate.run({ label: "running" }, () => new Promise<void>((resolve) => { release = resolve; }));
    const background = gate.run({ label: "bg" }, async () => order.push("background"));
    const user = gate.run({ label: "user", lane: "user" }, async () => order.push("user"));
    await Promise.resolve();
    release!();
    await Promise.all([blocker, background, user]);
    expect(order).toEqual(["user", "background"]);
  });
});
