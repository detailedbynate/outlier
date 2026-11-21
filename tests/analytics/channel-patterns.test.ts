import { describe, expect, it } from "vitest";
import { channelPatterns, hitRate, type PatternVideo } from "@/lib/analytics/channel-patterns";

const video = (overrides: Partial<PatternVideo>): PatternVideo => ({
  title: "A plain title",
  format: "short",
  duration_seconds: 45,
  published_at: "2026-11-02T15:00:00Z",
  view_count: 10_000,
  outlier_score: 1,
  ...overrides,
});

describe("channelPatterns", () => {
  it("finds a title habit that clearly beats the rest", () => {
    const videos = [
      ...Array.from({ length: 4 }, (_, i) => video({ title: `This is INSANE ${i}`, outlier_score: 3 })),
      ...Array.from({ length: 6 }, (_, i) => video({ title: `quiet title ${i}`, outlier_score: 1 })),
    ];
    const caps = channelPatterns(videos).find((p) => p.key === "title-caps");
    expect(caps?.title).toBe("Titles that shout a word in CAPS do better");
    expect(caps?.lift).toBe(3);
  });

  it("says nothing when the gap is small or one side is too thin", () => {
    const close = [...Array.from({ length: 5 }, () => video({ title: "Why?", outlier_score: 1.1 })), ...Array.from({ length: 5 }, () => video({ outlier_score: 1 }))];
    expect(channelPatterns(close).find((p) => p.key === "title-question")).toBeUndefined();
    const thin = [video({ title: "Why?", outlier_score: 9 }), ...Array.from({ length: 8 }, () => video({ outlier_score: 1 }))];
    expect(channelPatterns(thin).find((p) => p.key === "title-question")).toBeUndefined();
  });

  it("compares Shorts with long videos on views", () => {
    const videos = [
      ...Array.from({ length: 3 }, () => video({ format: "short", view_count: 50_000 })),
      ...Array.from({ length: 3 }, () => video({ format: "long_form", view_count: 5_000 })),
    ];
    expect(channelPatterns(videos).find((p) => p.key === "format")?.title).toBe("Shorts pull more views here");
  });

  it("finds the Short length that lands best", () => {
    const videos = [
      ...Array.from({ length: 4 }, () => video({ duration_seconds: 15, outlier_score: 2.5 })),
      ...Array.from({ length: 5 }, () => video({ duration_seconds: 50, outlier_score: 1 })),
    ];
    expect(channelPatterns(videos).find((p) => p.key === "length")?.title).toBe("Shorts under 20 seconds do best");
  });

  it("ignores videos without a score", () => {
    expect(channelPatterns([video({ outlier_score: null })])).toEqual([]);
  });
});

describe("hitRate", () => {
  it("counts uploads that doubled the usual", () => {
    expect(hitRate([video({ outlier_score: 2 }), video({ outlier_score: 0.5 }), video({ outlier_score: null })])).toEqual({ hits: 1, of: 2 });
  });
});
