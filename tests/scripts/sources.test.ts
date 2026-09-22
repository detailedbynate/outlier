import { describe, expect, it } from "vitest";
import { isAboutTopic, pickScriptSources, type Breakout } from "@/lib/scripts/sources";
import { scriptLines } from "@/lib/scripts/schema";

function breakout(over: Partial<Breakout> & { title: string }): Breakout {
  return {
    youtube_video_id: over.title.slice(0, 11).padEnd(11, "x").replace(/[^A-Za-z0-9_-]/g, "x"),
    channel_title: "Channel",
    view_count: 100_000,
    multiplier: 5,
    format: "short",
    published_at: new Date().toISOString(),
    ...over,
  };
}

describe("isAboutTopic", () => {
  it("matches on the video's own words, not its channel's", () => {
    expect(isAboutTopic("the redstone trick in minecraft", "minecraft")).toBe(true);
    expect(isAboutTopic("Big Brain Jett #valorant #valorantclips", "minecraft")).toBe(false);
  });

  it("reads hashtags as words", () => {
    expect(isAboutTopic("fastest house build ever 🤯 #minecraft #shorts", "minecraft")).toBe(true);
  });

  it("lets a topic through when it has no checkable words", () => {
    // "best videos" is all stopwords, so there is nothing to test a title against.
    expect(isAboutTopic("anything at all", "best videos")).toBe(true);
  });
});

describe("pickScriptSources", () => {
  const options = { topic: "minecraft", idea: "redstone trick", format: "short" as const, limit: 6 };

  it("drops the huge off-topic outlier the channel happened to post", () => {
    const picked = pickScriptSources(
      [
        breakout({ title: "Big Brain Jett #valorant #valorantclips", multiplier: 694 }),
        breakout({ title: "minecraft redstone door tutorial", multiplier: 6 }),
        breakout({ title: "minecraft farm that prints diamonds", multiplier: 5 }),
        breakout({ title: "minecraft base nobody can find", multiplier: 4 }),
      ],
      options,
    );
    expect(picked.map((p) => p.title)).not.toContain("Big Brain Jett #valorant #valorantclips");
    expect(picked).toHaveLength(3);
  });

  it("puts the outlier sharing the idea's words first", () => {
    const picked = pickScriptSources(
      [
        breakout({ title: "minecraft base nobody can find", multiplier: 9 }),
        breakout({ title: "minecraft redstone trick", multiplier: 4 }),
        breakout({ title: "minecraft farm that prints diamonds", multiplier: 8 }),
      ],
      options,
    );
    expect(picked[0]?.title).toBe("minecraft redstone trick");
  });

  it("prefers Shorts but keeps long form when that would leave too little", () => {
    const shortsOnly = pickScriptSources(
      [
        breakout({ title: "minecraft redstone guide", format: "long_form", multiplier: 20 }),
        breakout({ title: "minecraft redstone clock", format: "short", multiplier: 4 }),
        breakout({ title: "minecraft piston door", format: "short", multiplier: 4 }),
        breakout({ title: "minecraft hidden base", format: "short", multiplier: 4 }),
      ],
      options,
    );
    expect(shortsOnly.every((p) => p.format === "short")).toBe(true);

    const tooFewShorts = pickScriptSources(
      [
        breakout({ title: "minecraft redstone guide", format: "long_form", multiplier: 20 }),
        breakout({ title: "minecraft survival guide", format: "long_form", multiplier: 10 }),
        breakout({ title: "minecraft redstone clock", format: "short", multiplier: 4 }),
      ],
      options,
    );
    expect(tooFewShorts).toHaveLength(3);
    expect(tooFewShorts[0]?.format).toBe("short");
  });

  it("would rather show off-topic outliers than nothing at all", () => {
    const picked = pickScriptSources(
      [
        breakout({ title: "Big Brain Jett #valorant", multiplier: 694 }),
        breakout({ title: "anime meme shorts", multiplier: 218 }),
        breakout({ title: "fastest house build ever", multiplier: 112 }),
      ],
      options,
    );
    expect(picked).toHaveLength(3);
  });

  it("returns nothing when the niche has no breakouts", () => {
    expect(pickScriptSources([], options)).toEqual([]);
  });
});

describe("scriptLines", () => {
  it("keeps the lines the model gave us", () => {
    expect(scriptLines("First line.\nSecond line.")).toEqual(["First line.", "Second line."]);
  });

  it("recovers lines from a run-on block, spaces or not", () => {
    // What nemotron actually returned: sentences welded together, no space after the stop.
    const blob = "Your door breaks because you push it with a piston.Doors aren't pushable.Use a block instead.";
    expect(scriptLines(blob)).toEqual(["Your door breaks because you push it with a piston.", "Doors aren't pushable.", "Use a block instead."]);
  });

  it("leaves a mid-sentence full stop alone", () => {
    expect(scriptLines("It cost £4.50 and took ten minutes.")).toEqual(["It cost £4.50 and took ten minutes."]);
  });
});
