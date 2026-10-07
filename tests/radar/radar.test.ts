import { describe, expect, it } from "vitest";
import { acceptableForAds, parseDemand, trendOf } from "@/lib/radar/demand";
import { classifyTitle, parseListing } from "@/lib/radar/reddit";
import { scoreRadar } from "@/lib/radar/score";
import { expansionQueries, isUsefulPhrase, normalizeKeyword, parseSuggestions } from "@/lib/radar/suggest";
import { measureSupply } from "@/lib/radar/supply";
import type { YouTubeChannel, YouTubeVideo } from "@/types/youtube";

const NOW = new Date("2026-10-07T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function video(id: string, channelId: string, views: number, publishedAt: string, durationSeconds = 600): YouTubeVideo {
  return { id, channelId, channelTitle: channelId, title: `video ${id}`, publishedAt, durationSeconds, statistics: { viewCount: views, likeCount: null, commentCount: null } } as YouTubeVideo;
}
function channel(id: string, subs: number): YouTubeChannel {
  return { id, statistics: { subscriberCount: subs, hiddenSubscriberCount: false } } as YouTubeChannel;
}

describe("autocomplete", () => {
  it("parses suggestions with their rank and drops duplicates", () => {
    expect(parseSuggestions(["q", ["Credit Card for Beginners", "credit card for beginners", "credit card fraud!"]])).toEqual([
      { phrase: "credit card for beginners", rank: 0 },
      { phrase: "credit card fraud", rank: 2 },
    ]);
    expect(parseSuggestions({})).toEqual([]);
  });

  it("sweeps the alphabet for seeds only", () => {
    expect(expansionQueries("budgeting", 0)).toContain("budgeting z");
    expect(expansionQueries("budgeting", 0).length).toBe(32);
    expect(expansionQueries("budgeting tips", 1)).toHaveLength(4);
    expect(expansionQueries("budgeting tips for", 2)).toEqual(["budgeting tips for"]);
  });

  it("keeps topics, drops songs and one-word noise", () => {
    expect(isUsefulPhrase("roth ira explained", "roth ira")).toBe(true);
    expect(isUsefulPhrase("roth ira song lyrics", "roth ira")).toBe(false);
    expect(isUsefulPhrase("roth", "roth ira")).toBe(false);
    expect(isUsefulPhrase("sbi credit card kaise use kare", "credit card")).toBe(false);
    // Word boundaries: "chair" and "restaurant" are not Hindi.
    expect(isUsefulPhrase("best office chair for back pain", "office chair")).toBe(true);
    expect(isUsefulPhrase("restaurant business plan", "restaurant")).toBe(true);
    expect(normalizeKeyword("  AI   Tools!! ")).toBe("ai tools");
  });
});

describe("supply", () => {
  it("sees a gap when old results still get views and small channels win", () => {
    const open = measureSupply(
      [video("a", "small", 80_000, daysAgo(400)), video("b", "small2", 50_000, daysAgo(300)), video("c", "mid", 30_000, daysAgo(500)), video("d", "small3", 40_000, daysAgo(20), 45)],
      [channel("small", 5_000), channel("small2", 12_000), channel("mid", 200_000), channel("small3", 3_000)],
      NOW,
    );
    const crowded = measureSupply(
      [video("a", "big", 2_000_000, daysAgo(5)), video("b", "big2", 900_000, daysAgo(10)), video("c", "big", 700_000, daysAgo(30))],
      [channel("big", 5_000_000), channel("big2", 3_000_000)],
      NOW,
    );
    expect(open.smallWins).toBe(3);
    expect(open.recentShare).toBe(0.25);
    expect(open.shortsShare).toBe(0.25);
    expect(open.top[0]!.id).toBe("a");
    expect(open.gap).toBeGreaterThan(crowded.gap);
    expect(crowded.bigShare).toBe(1);
  });

  it("handles no results", () => {
    expect(measureSupply([], [], NOW)).toMatchObject({ results: 0, gap: 0, top: [] });
  });
});

describe("demand", () => {
  const monthly = (recent: number, yearAgo: number) =>
    Array.from({ length: 24 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 8 - i, 1));
      return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, search_volume: i < 12 ? recent : yearAgo };
    });

  it("reads volume, cpc and the year-over-year trend", () => {
    const parsed = parseDemand({ tasks: [{ result: [{ keyword: "Roth IRA", search_volume: 90_500, cpc: 4.567, competition_index: 40, monthly_searches: monthly(150, 100) }] }] });
    expect(parsed.get("roth ira")).toEqual({ volume: 90_500, cpc: 4.57, competition: 40, trend: 0.5, peakMonth: null, source: "dataforseo" });
  });

  it("needs a year of history for a trend", () => {
    expect(trendOf(monthly(1, 1).slice(0, 6)).trend).toBeNull();
  });

  it("only sends what Google Ads accepts", () => {
    expect(acceptableForAds("credit card for students")).toBe(true);
    expect(acceptableForAds("c++ tutorial")).toBe(false);
  });
});

describe("reddit", () => {
  it("sorts titles into questions, stories and discussions", () => {
    expect(classifyTitle("Should I pay off my 3% mortgage early?")).toBe("question");
    expect(classifyTitle("ELI5: why do bonds lose value")).toBe("question");
    expect(classifyTitle("I finally paid off $40k in debt")).toBe("story");
    expect(classifyTitle("The 4% rule is misunderstood")).toBe("discussion");
  });

  it("skips pinned and NSFW posts and keeps the category", () => {
    const posts = parseListing(
      {
        data: {
          children: [
            { data: { title: "Weekly thread", permalink: "/r/personalfinance/1", stickied: true } },
            { data: { title: "How do I start investing?", permalink: "/r/personalfinance/2", score: 900, num_comments: 300, created_utc: 1_791_000_000, subreddit: "personalfinance" } },
            { data: { title: "nsfw", permalink: "/r/personalfinance/3", over_18: true } },
          ],
        },
      },
      "personalfinance",
    );
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ kind: "question", category: "Finance & Business", url: "https://www.reddit.com/r/personalfinance/2" });
  });
});

describe("radar score", () => {
  const supply = measureSupply([video("a", "small", 80_000, daysAgo(400)), video("b", "small2", 60_000, daysAgo(300))], [channel("small", 5_000), channel("small2", 9_000)], NOW);

  it("isn't scored before its results are read", () => {
    expect(scoreRadar({ keyword: "roth ira", depth: 1, suggestRank: 0, category: null, supply: null, demand: null, ease: null })).toBeNull();
  });

  it("pays more for a high-CPC phrase than a cheap one with the same supply", () => {
    const base = { keyword: "roth ira for beginners", depth: 1, suggestRank: 1, category: null, supply, ease: null };
    const rich = scoreRadar({ ...base, demand: { volume: 20_000, cpc: 12, competition: 50, trend: 0.2, peakMonth: null, source: "dataforseo" } })!;
    const cheap = scoreRadar({ ...base, demand: { volume: 20_000, cpc: 0.3, competition: 50, trend: 0.2, peakMonth: null, source: "dataforseo" } })!;
    expect(rich.parts.pay).toBeGreaterThan(cheap.parts.pay);
    expect(rich.total).toBeGreaterThan(cheap.total);
    expect(rich.format).toBe("long_form");
  });

  it("lifts a phrase that only just appeared in autocomplete", () => {
    const base = { keyword: "roth ira new limits", depth: 1, suggestRank: 1, category: null, supply, demand: null, ease: null };
    expect(scoreRadar({ ...base, rising: true })!.total).toBeGreaterThan(scoreRadar(base)!.total);
  });
});
