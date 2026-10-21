import { describe, expect, it } from "vitest";
import { videoBreakdown } from "@/lib/analytics/video-breakdown";
import { videoInsights } from "@/lib/analytics/video-insights";
import type { YouTubeVideo } from "@/types/youtube";

const NOW = new Date("2026-09-30T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function video(id: string, overrides: Partial<YouTubeVideo> = {}, stats: Partial<YouTubeVideo["statistics"]> = {}): YouTubeVideo {
  return {
    id,
    channelId: "UC1",
    channelTitle: "Chan",
    title: "a normal title about building things",
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

function run(target: YouTubeVideo, peers: YouTubeVideo[], medianViews = 10_000, growth = { last24h: null as number | null, last7d: null as number | null }) {
  const insights = videoInsights(target, 50_000, peers, growth, NOW);
  return videoBreakdown({ video: target, peers, insights, medianViews, growth }, NOW);
}

// Mondays get 20K, Thursdays 5K; questions do well, short ones (≤15s) too.
const peers = [
  ...Array.from({ length: 5 }, (_, i) => video(`mon${i}`, { publishedAt: "2026-09-07T15:00:00Z", title: "Why does this work?", durationSeconds: 12 }, { viewCount: 20_000 })),
  ...Array.from({ length: 5 }, (_, i) => video(`thu${i}`, { publishedAt: "2026-09-10T15:00:00Z", durationSeconds: 50 }, { viewCount: 5_000 })),
];

describe("videoBreakdown", () => {
  it("counts the settled uploads it beat", () => {
    const out = run(video("hit", { publishedAt: daysAgo(5) }, { viewCount: 15_000 }), peers);
    expect(out.beats).toEqual({ count: 5, of: 10 });
    expect(out.percentile).toBe(0.5);
  });

  it("doesn't rank a Short still in its first days", () => {
    const out = run(video("new", { publishedAt: new Date(NOW.getTime() - 5 * 3_600_000).toISOString() }, { viewCount: 800 }), peers);
    expect(out.beats).toBeNull();
    expect(out.percentile).toBeNull();
  });

  it("leaves uploads still collecting views out of the count", () => {
    const fresh = Array.from({ length: 4 }, (_, i) => video(`fresh${i}`, { publishedAt: daysAgo(1) }, { viewCount: 300 }));
    const out = run(video("hit", { publishedAt: daysAgo(5) }, { viewCount: 15_000 }), [...peers, ...fresh]);
    expect(out.beats).toEqual({ count: 5, of: 10 });
  });

  it("finds the posting day and length that work, from settled uploads", () => {
    const out = run(video("hit", { publishedAt: "2026-09-24T15:00:00Z", durationSeconds: 14 }), peers);
    const days = out.weekdays!;
    expect(days.days[days.best!]!.label).toBe("Mon");
    expect(days.days.find((d) => d.current)!.label).toBe("Thu");
    const lengths = out.lengths!;
    expect(lengths.buckets[lengths.best!]!.label).toBe("≤15s");
    expect(lengths.buckets.find((b) => b.current)!.label).toBe("≤15s");
    // Only the lengths the channel uses, end to end.
    expect(lengths.buckets.map((b) => b.label)).toEqual(["≤15s", "16–30s", "31–45s", "46–60s"]);
  });

  it("compares title traits with and without", () => {
    const out = run(video("hit", { title: "How?" }), peers);
    const question = out.traits.find((t) => t.key === "question")!;
    expect(question.has).toBe(true);
    expect(question.withIt).toBe(2);
    expect(question.without).toBe(0.5);
  });

  it("leaves out uploads too new to have settled", () => {
    const fresh = Array.from({ length: 10 }, (_, i) => video(`new${i}`, { publishedAt: daysAgo(1) }));
    const out = run(video("hit"), fresh);
    expect(out.top).toEqual([]);
    expect(out.weekdays).toBeNull();
    expect(out.lengths).toBeNull();
  });

  it("ranks the channel's best uploads by multiple", () => {
    const out = run(video("hit"), peers);
    expect(out.top.map((t) => t.multiple)).toEqual([2, 2, 2]);
  });

  it("reports momentum only when there's history", () => {
    expect(run(video("hit"), peers).momentum).toBeNull();
    const out = run(video("hit", {}, { viewCount: 20_000 }), peers, 10_000, { last24h: 2_000, last7d: 9_000 });
    expect(out.momentum).toEqual({ last24h: 2_000, last7d: 9_000, share24h: 0.1 });
  });
});
