import { describe, expect, it } from "vitest";
import { computeNicheMetrics, tokenize, type NicheChannel, type NicheVideo } from "@/lib/niches/analysis";
import { nicheFit } from "@/lib/niches/fit";
import { breakoutPatterns, SCORE_WEIGHTS, weeklyUploads } from "@/lib/niches/insights";
import { isSaved, readSavedNiches, withoutSaved, withSaved } from "@/lib/niches/saved";

const NOW = new Date("2026-09-29T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function video(i: number, overrides: Partial<NicheVideo> = {}): NicheVideo {
  return {
    id: `v${i}`,
    youtube_video_id: `yt${i}`,
    channel_id: `c${i % 6}`,
    title: `redstone door build ${i}`,
    tags: [],
    format: "short",
    view_count: 10_000,
    like_count: null,
    comment_count: null,
    published_at: daysAgo(i % 60),
    outlier_score: 1,
    ...overrides,
  };
}

const channels = new Map<string, NicheChannel>(
  Array.from({ length: 6 }, (_, i) => [`c${i}`, { id: `c${i}`, youtube_channel_id: `UC${i}`, title: `Channel ${i}`, thumbnail_url: null, subscriber_count: 20_000 }]),
);

describe("score parts", () => {
  it("add up to the opportunity score", () => {
    const videos = Array.from({ length: 60 }, (_, i) => video(i, { outlier_score: i % 5 === 0 ? 4 : 1 }));
    const m = computeNicheMetrics(videos, channels, NOW);
    const total = Math.round(100 * m.scoreParts!.reduce((s, p) => s + p.score * p.weight, 0));
    expect(total).toBe(m.opportunity);
    expect(m.scoreParts!.map((p) => p.key)).toEqual(Object.keys(SCORE_WEIGHTS));
  });
});

describe("weeklyUploads", () => {
  it("buckets uploads by week, oldest first", () => {
    const weeks = weeklyUploads([video(1, { published_at: daysAgo(1), view_count: 100 }), video(2, { published_at: daysAgo(2), view_count: 300 }), video(3, { published_at: daysAgo(10) })], NOW, 4);
    expect(weeks).toHaveLength(4);
    expect(weeks[3]).toMatchObject({ uploads: 2, medianViews: 200 });
    expect(weeks[2]!.uploads).toBe(1);
    expect(weeks[0]!.uploads).toBe(0);
  });
});

describe("breakoutPatterns", () => {
  const all = Array.from({ length: 40 }, (_, i) => video(i, { title: i < 8 ? `SECRET hidden base trick ${i}?` : `redstone door build ${i}` }));
  const breakouts = all.slice(0, 8);

  it("finds words and habits breakouts share", () => {
    const p = breakoutPatterns(all, breakouts, tokenize)!;
    expect(p.breakouts).toBe(8);
    expect(p.words.map((w) => w.word)).toContain("hidden");
    expect(p.words.map((w) => w.word)).not.toContain("redstone");
    expect(p.traits.find((t) => t.key === "question")).toMatchObject({ breakout: 1 });
    expect(p.traits.find((t) => t.key === "caps")!.breakout).toBe(1);
  });

  it("says nothing with too few breakouts", () => {
    expect(breakoutPatterns(all, breakouts.slice(0, 3), tokenize)).toBeUndefined();
  });
});

describe("nicheFit", () => {
  const metrics = computeNicheMetrics(
    Array.from({ length: 60 }, (_, i) => video(i)),
    channels,
    NOW,
  );

  it("calls a much smaller channel a stretch", () => {
    const fit = nicheFit(metrics, { title: "Me", subscribers: 5_000, monthViews: 1_000, uploads30d: 2, medianViews: 500 })!;
    expect(fit.verdict).toBe("stretch");
    expect(fit.rows.map((r) => r.key)).toEqual(["monthly", "perUpload", "pace"]);
  });

  it("calls a bigger channel ahead", () => {
    expect(nicheFit(metrics, { title: "Me", subscribers: 500_000, monthViews: 10_000_000, uploads30d: 30, medianViews: 200_000 })!.verdict).toBe("ahead");
  });
});

describe("saved niches", () => {
  it("adds, dedupes and removes", () => {
    let list = withSaved([], "Minecraft", 60, NOW);
    list = withSaved(list, "cooking", 50, NOW);
    list = withSaved(list, "minecraft", 64, NOW);
    expect(list.map((n) => n.key)).toEqual(["minecraft", "cooking"]);
    expect(list[0]!.score).toBe(64);
    expect(isSaved(list, "MINECRAFT")).toBe(true);
    expect(withoutSaved(list, "minecraft").map((n) => n.key)).toEqual(["cooking"]);
  });

  it("ignores malformed metadata", () => {
    expect(readSavedNiches({ saved_niches: [{ topic: "x", score: 1, savedAt: "2026-01-01" }, { nope: true }, "junk"] })).toHaveLength(1);
    expect(readSavedNiches({ saved_niches: "junk" })).toEqual([]);
    expect(readSavedNiches(undefined)).toEqual([]);
  });
});
