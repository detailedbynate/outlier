import { describe, expect, it } from "vitest";
import { bestIndex, competitorAverage, computeChannelStats } from "@/lib/analytics/compare";

const NOW = new Date("2026-09-14T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const video = (format: string, views: number, age: number, likes = views * 0.05) => ({
  format,
  view_count: views,
  like_count: likes,
  comment_count: 0,
  published_at: daysAgo(age),
});

describe("computeChannelStats", () => {
  it("derives typical views, hit rate, pace, and growth from public data", () => {
    const stats = computeChannelStats(
      {
        subscriberCount: 10_000,
        viewCount: 2_000_000,
        videoCount: 40,
        createdAt: daysAgo(400),
        videos: [video("short", 1_000, 1), video("short", 1_000, 5), video("short", 1_000, 10), video("short", 10_000, 20), video("long_form", 5_000, 60)],
        subscriberHistory: [
          { capturedAt: daysAgo(8), value: 9_000 },
          { capturedAt: daysAgo(0), value: 10_000 },
        ],
      },
      NOW,
    );
    expect(stats).toMatchObject({
      medianShortViews: 1_000,
      medianLongViews: 5_000,
      viewsPerSub: 0.1,
      uploadsPerWeek: 1,
      shortsShare: 0.8,
      hitRate: 0.4,
      topMultiplier: 10,
      channelAgeDays: 400,
      subs7d: 1_000,
      subs30d: null,
    });
    expect(stats.avgEngagement).toBeCloseTo(0.05);
  });

  it("handles channels with no uploads", () => {
    const stats = computeChannelStats({ subscriberCount: null, viewCount: 0, videoCount: 0, createdAt: null, videos: [], subscriberHistory: [] }, NOW);
    expect(stats).toMatchObject({ medianShortViews: null, hitRate: null, viewsPerSub: null, uploadsPerWeek: 0, shortsShare: null });
  });
});

describe("bestIndex / competitorAverage", () => {
  it("picks a unique winner and ignores unknowns", () => {
    expect(bestIndex([5, 9, null], true)).toBe(1);
    expect(bestIndex([5, 9, 9], true)).toBeNull();
    expect(bestIndex([5, 9], null)).toBeNull();
    expect(competitorAverage([{ subscribers: 10 }, { subscribers: null }, { subscribers: 30 }] as never, "subscribers")).toBe(20);
  });
});