import { describe, expect, it } from "vitest";
import { DEFAULT_QUALITY, isSpammyTitle, latinLetterShare, qualityConfigFrom, rejectReason, underratedScore } from "@/lib/research/quality";
import { makeChannel, makeVideo } from "../helpers/fixtures";

describe("quality rules", () => {
  it("accepts an English, engaging, underrated video from an established small channel", () => {
    expect(rejectReason(makeVideo(), makeChannel())).toBeNull();
  });

  it("rejects other languages, via metadata or the title's script", () => {
    expect(rejectReason(makeVideo({ defaultAudioLanguage: "es" }), makeChannel())).toBe("language");
    expect(rejectReason(makeVideo({ defaultAudioLanguage: "en-US", defaultLanguage: null }), makeChannel())).toBeNull();
    const hindiTitle = makeVideo({ defaultAudioLanguage: null, defaultLanguage: null, title: "सबसे अच्छा खाना बनाने का तरीका" });
    expect(rejectReason(hindiTitle, makeChannel())).toBe("language");
  });

  it("rejects channels outside the target countries but allows unlisted ones", () => {
    expect(rejectReason(makeVideo(), makeChannel({ country: "BR" }))).toBe("country");
    expect(rejectReason(makeVideo(), makeChannel({ country: null }))).toBeNull();
  });

  it("rejects junk: kids content, very short clips, spammy titles", () => {
    expect(rejectReason(makeVideo({ madeForKids: true }), makeChannel())).toBe("made_for_kids");
    expect(rejectReason(makeVideo({ durationSeconds: 6 }), makeChannel())).toBe("too_short");
    expect(rejectReason(makeVideo({ title: "#shorts #viral #fyp #trending" }), makeChannel())).toBe("spam_title");
    expect(rejectReason(makeVideo({ title: "Funniest fails compilation part 7" }), makeChannel())).toBe("spam_title");
  });

  it("requires big views relative to a small channel", () => {
    expect(rejectReason(makeVideo({ views: 50_000 }), makeChannel())).toBe("low_views");
    expect(rejectReason(makeVideo(), makeChannel({ subscribers: 2_000_000 }))).toBe("too_big");
    expect(rejectReason(makeVideo({ views: 150_000 }), makeChannel({ subscribers: 80_000 }))).toBe("low_ratio");
    expect(rejectReason(makeVideo(), makeChannel({ subscribers: null }))).toBe("hidden_subscribers");
    // Discovery skips the size rules.
    expect(rejectReason(makeVideo(), makeChannel({ subscribers: 2_000_000 }), DEFAULT_QUALITY, { sizeRules: false })).toBeNull();
  });

  it("requires real engagement and an established channel", () => {
    expect(rejectReason(makeVideo({ likes: 500, comments: 10 }), makeChannel())).toBe("low_engagement");
    expect(rejectReason(makeVideo({ likes: null, comments: null }), makeChannel())).toBe("low_engagement");
    expect(rejectReason(makeVideo(), makeChannel({ videoCount: 2 }))).toBe("tiny_channel");
  });

  it("scores smaller channels and stronger engagement higher", () => {
    const small = underratedScore(makeVideo(), makeChannel({ subscribers: 5_000 }));
    const bigger = underratedScore(makeVideo(), makeChannel({ subscribers: 60_000 }));
    const engaged = underratedScore(makeVideo({ likes: 60_000 }), makeChannel({ subscribers: 5_000 }));
    expect(small).toBeGreaterThan(bigger);
    expect(engaged).toBeGreaterThan(small);
  });

  it("title helpers", () => {
    expect(latinLetterShare("Hello world")).toBe(1);
    expect(latinLetterShare("こんにちは")).toBe(0);
    expect(isSpammyTitle("I tried the viral pasta recipe #shorts")).toBe(false);
    expect(isSpammyTitle("🔥🔥🔥🔥🔥🔥 wow")).toBe(true);
  });

  it("builds config from env settings", () => {
    const config = qualityConfigFrom({
      OUTLIER_LANGUAGE: "EN",
      OUTLIER_COUNTRIES: "us, gb ,",
      OUTLIER_MIN_VIEWS: 50_000,
      OUTLIER_MAX_SUBSCRIBERS: 30_000,
      OUTLIER_MIN_VIEWS_PER_SUB: 20,
      OUTLIER_MIN_ENGAGEMENT: 0.02,
    });
    expect(config).toMatchObject({ language: "en", countries: ["US", "GB"], minViews: 50_000, maxSubscribers: 30_000 });
  });
});
