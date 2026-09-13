import { describe, expect, it } from "vitest";
import {
  computeVideoPerformance,
  deltaOverWindow,
  engagementRate,
  growthRate,
  median,
  outlierScore,
  viewsPerDay,
} from "@/lib/analytics/metrics";

const NOW = new Date("2026-09-13T00:00:00Z");

describe("analytics metrics", () => {
  it("viewsPerDay divides by age and floors very new videos at one hour", () => {
    expect(viewsPerDay(10_000, "2026-09-03T00:00:00Z", NOW)).toBe(1000);
    expect(viewsPerDay(100, "2026-09-12T23:59:00Z", NOW)).toBe(2400);
    expect(viewsPerDay(0, "2026-09-01T00:00:00Z", NOW)).toBe(0);
  });

  it("engagementRate handles hidden signals", () => {
    expect(engagementRate(1000, 50, 10)).toBe(0.06);
    expect(engagementRate(1000, null, 10)).toBe(0.01);
    expect(engagementRate(1000, null, null)).toBeNull();
    expect(engagementRate(0, 5, 5)).toBeNull();
  });

  it("median works for odd, even, and empty inputs", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("outlierScore compares against the channel baseline", () => {
    expect(outlierScore(50_000, 10_000)).toBe(5);
    expect(outlierScore(50_000, null)).toBeNull();
    expect(outlierScore(50_000, 0)).toBeNull();
  });

  it("deltaOverWindow uses the latest snapshot at or before the window start", () => {
    const points = [
      { capturedAt: "2026-09-05T00:00:00Z", value: 100 },
      { capturedAt: "2026-09-12T00:00:00Z", value: 900 },
      { capturedAt: "2026-09-11T00:00:00Z", value: 700 },
      { capturedAt: "2026-09-13T00:00:00Z", value: 1000 },
    ];
    expect(deltaOverWindow(points, 24)).toBe(100);
    expect(deltaOverWindow(points, 24 * 7)).toBe(900);
    expect(deltaOverWindow(points, 24 * 30)).toBeNull();
    expect(deltaOverWindow(points.slice(0, 1), 24)).toBeNull();
  });

  it("growthRate", () => {
    expect(growthRate(100, 150)).toBe(0.5);
    expect(growthRate(0, 150)).toBeNull();
  });

  it("computeVideoPerformance combines everything", () => {
    const metrics = computeVideoPerformance(
      {
        viewCount: 100_000,
        likeCount: 4_000,
        commentCount: 1_000,
        publishedAt: "2026-09-03T00:00:00Z",
        channelRecentViewCounts: [10_000, 20_000, 30_000],
        viewSnapshots: [
          { capturedAt: "2026-09-12T00:00:00Z", value: 80_000 },
          { capturedAt: "2026-09-13T00:00:00Z", value: 100_000 },
        ],
      },
      NOW,
    );
    expect(metrics).toEqual({
      viewsPerDay: 10_000,
      engagementRate: 0.05,
      outlierScore: 5,
      channelMedianViews: 20_000,
      viewsDelta24h: 20_000,
      viewsDelta7d: null,
      viewsDelta30d: null,
    });
  });
});
