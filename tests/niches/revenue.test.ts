import { describe, expect, it } from "vitest";
import { categoryFor, estimateEarnings, formatMoney, formatMoneyRange } from "@/lib/niches/revenue";

describe("niche earnings", () => {
  it("finds a category from the dictionary, then from telltale words", () => {
    expect(categoryFor("my singing monsters")).toBe("Gaming");
    expect(categoryFor("dividend investing")).toBe("Finance & Business");
    expect(categoryFor("zzzz", "home workouts")).toBe("Fitness & Health");
    expect(categoryFor("qwerty")).toBeNull();
  });

  it("blends Shorts and long-form RPM by where the views come from", () => {
    const allShorts = estimateEarnings({ typical: 1_000_000, top: 10_000_000, shortsShare: 1 }, "personal finance")!;
    expect(allShorts.category).toBe("Finance & Business");
    expect(allShorts.blendedRpm).toEqual(allShorts.rpm.shorts);
    expect(allShorts.typicalMonthly[0]).toBeCloseTo(80);
    expect(allShorts.topMonthly[1]).toBeCloseTo(2_500);

    const allLong = estimateEarnings({ typical: 100_000, top: 100_000, shortsShare: 0 }, "personal finance")!;
    expect(allLong.typicalMonthly).toEqual([800, 2_000]);
  });

  it("falls back to a general band for unknown topics and skips old reports", () => {
    expect(estimateEarnings({ typical: 1_000, top: 1_000, shortsShare: 0 }, "qwerty")!.rpm.long).toEqual([1.5, 4]);
    expect(estimateEarnings(undefined, "fitness")).toBeNull();
  });

  it("formats money compactly", () => {
    expect(formatMoney(0.046)).toBe("$0.05");
    expect(formatMoney(850.4)).toBe("$850");
    expect(formatMoney(12_345)).toBe("$12K");
    expect(formatMoney(2_400_000)).toBe("$2.4M");
    expect(formatMoneyRange([1200, 3000])).toBe("$1.2K–$3.0K");
  });
});
