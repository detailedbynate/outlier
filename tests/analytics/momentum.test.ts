import { describe, expect, it } from "vitest";
import { computeMomentum, viewsPerHour } from "@/lib/analytics/momentum";

const NOW = new Date("2026-09-16T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe("viewsPerHour", () => {
  it("uses the delta between checks, or the since-upload average on the first check", () => {
    expect(viewsPerHour({ views: 12_000, checkedAt: NOW, publishedAt: hoursAgo(10), previous: { views: 10_000, checkedAt: hoursAgo(2), viewsPerHour: null } })).toBe(1_000);
    expect(viewsPerHour({ views: 5_000, checkedAt: NOW, publishedAt: hoursAgo(10), previous: null })).toBe(500);
    // Checks minutes apart are too noisy: fall back to the average.
    expect(viewsPerHour({ views: 5_000, checkedAt: NOW, publishedAt: hoursAgo(10), previous: { views: 4_990, checkedAt: hoursAgo(0.05), viewsPerHour: 900 } })).toBe(500);
  });
});

describe("computeMomentum", () => {
  it("marks fast-growing videos hot and checks them hourly", () => {
    const result = computeMomentum({ views: 60_000, checkedAt: NOW, publishedAt: hoursAgo(20), previous: { views: 50_000, checkedAt: hoursAgo(2), viewsPerHour: 3_000 } });
    expect(result).toMatchObject({ viewsPerHour: 5_000, acceleration: 2_000, priority: 3 });
    expect(result.nextCheckAt?.toISOString()).toBe("2026-09-16T13:00:00.000Z");
  });

  it("treats a breakout relative to a small channel as hot", () => {
    const result = computeMomentum({ views: 9_000, checkedAt: NOW, publishedAt: hoursAgo(100), previous: { views: 3_000, checkedAt: hoursAgo(12), viewsPerHour: 100 }, channelMedianViews: 2_000 });
    expect(result.priority).toBe(3);
    expect(result.outlierScore).toBe(4.5);
  });

  it("keeps young uploads warm, cools older ones, and retires stale videos", () => {
    expect(computeMomentum({ views: 100, checkedAt: NOW, publishedAt: hoursAgo(5), previous: null }).priority).toBe(2);
    expect(computeMomentum({ views: 1_000, checkedAt: NOW, publishedAt: hoursAgo(24 * 7), previous: null }).priority).toBe(1);
    const cold = computeMomentum({ views: 1_000, checkedAt: NOW, publishedAt: hoursAgo(24 * 30), previous: null });
    expect(cold.priority).toBe(0);
    expect(cold.nextCheckAt?.toISOString()).toBe("2026-09-19T12:00:00.000Z");
    expect(computeMomentum({ views: 1_000, checkedAt: NOW, publishedAt: hoursAgo(24 * 90), previous: null }).nextCheckAt).toBeNull();
  });
});
