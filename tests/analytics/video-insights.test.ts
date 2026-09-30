import { describe, expect, it } from "vitest";
import { hashtagsOf, videoInsights } from "@/lib/analytics/video-insights";
import type { YouTubeVideo } from "@/types/youtube";

const NOW = new Date("2026-09-30T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function video(id: string, overrides: Partial<YouTubeVideo> = {}, stats: Partial<YouTubeVideo["statistics"]> = {}): YouTubeVideo {
  return {
    id,
    channelId: "UC1",
    channelTitle: "Chan",
    title: "a normal title about building things here",
    description: "",
    publishedAt: daysAgo(10),
    durationSeconds: 40,
    format: "short",
    formatSource: "duration",
    categoryId: null,
    tags: [],
    defaultLanguage: null,
    defaultAudioLanguage: null,
    thumbnailUrl: null,
    definition: null,
    hasCaptions: null,
    madeForKids: null,
    liveBroadcastContent: null,
    topicCategories: [],
    statistics: { viewCount: 10_000, likeCount: 400, commentCount: 20, ...stats },
    ...overrides,
  } as YouTubeVideo;
}

// Ten ordinary uploads, posted on Mondays.
const peers = Array.from({ length: 10 }, (_, i) => video(`p${i}`, { publishedAt: new Date(Date.UTC(2026, 8, 7 + (i % 3) * 7, 15)).toISOString() }));

describe("videoInsights", () => {
  it("ranks a breakout first and explains what's different", () => {
    const hit = video("hit", { title: "Why?", durationSeconds: 15, publishedAt: daysAgo(5) }, { viewCount: 900_000, likeCount: 81_000, commentCount: 9_000 });
    const out = videoInsights(hit, 50_000, peers, { last24h: 60_000, last7d: null }, NOW);

    expect(out.rank).toEqual({ position: 1, of: 11 });
    expect(out.viewsPerSubscriber).toBe(18);
    const text = out.highlights.map((h) => h.text).join("\n");
    expect(text).toContain("More views than any of the channel's 10 other recent Shorts");
    expect(text).toContain("18× the channel's subscriber count");
    expect(text).toContain("like rate");
    expect(text).toContain("comments per view");
    expect(text).toContain("Still climbing");
    expect(text).toContain("Shorter than the channel's usual");
    expect(text).toContain("a question");
  });

  it("stays quiet about an ordinary upload", () => {
    const out = videoInsights(video("same"), 50_000, peers, { last24h: null, last7d: null }, NOW);
    expect(out.highlights.filter((h) => h.tone !== "info")).toEqual([]);
  });

  it("skips the rank without enough history", () => {
    expect(videoInsights(video("x"), null, peers.slice(0, 2), { last24h: null, last7d: null }, NOW).rank).toBeNull();
  });
});

describe("hashtagsOf", () => {
  it("collects unique hashtags from the title and description", () => {
    expect(hashtagsOf({ title: "Big build #minecraft #shorts", description: "more #Minecraft and #redstone_tips" })).toEqual(["#minecraft", "#shorts", "#redstone_tips"]);
  });
});

describe("old videos", () => {
  it("says the comparison is loose and skips reach and posting-day claims", () => {
    const classic = video("old", { publishedAt: "2009-10-25T06:00:00Z" }, { viewCount: 1_500_000_000, likeCount: 16_000_000, commentCount: 2_000_000 });
    const out = videoInsights(classic, 4_000_000, peers, { last24h: null, last7d: null }, NOW);
    const text = out.highlights.map((h) => h.text).join("\n");
    expect(text).toContain("This video is from Oct 2009");
    expect(text).not.toContain("subscriber count");
    expect(text).not.toContain("posts most on");
  });
});
