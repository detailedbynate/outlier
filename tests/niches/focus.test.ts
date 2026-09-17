import { describe, expect, it } from "vitest";
import { isAboutTopic, isClipChannel, topicFocus, type ChannelProfile } from "@/lib/niches/focus";

const profile = (titles: string[], overrides: Partial<ChannelProfile> = {}): ChannelProfile => ({
  topicCategories: [],
  description: null,
  contentLanguage: "en",
  uploads: titles.map((title) => ({ title, tags: [] })),
  ...overrides,
});

describe("topic focus", () => {
  it("doesn't count a channel for a topic it mentioned once", () => {
    const vsauce = profile(["Who Said The First Bad Word On The Moon?", "The Ambitrope Coin", "Audio Palindromes", "Is crime genetic?", "The Singularity Disc"]);
    expect(topicFocus(vsauce.uploads, "crime")).toEqual({ hits: 1, share: 0.2 });
    expect(isAboutTopic(vsauce, "crime")).toBe(false);
  });

  it("counts a channel whose uploads are about the topic, hashtags included", () => {
    const channel = profile([
      "Horrible story behind the meme #crimestory",
      "He's an absolute monster #crimenews",
      "Man breaks into jail #truecrimecommunity",
      "Rescued in the ocean #breakingnews",
    ]);
    expect(isAboutTopic(channel, "crime")).toBe(true);
    expect(isAboutTopic(channel, "true crime")).toBe(false);
  });

  it("leaves out TV clip channels and non-English channels", () => {
    const titles = ["Fargo: who would kill my wife #crime", "Fargo #crime #plot", "Billions #crime", "Fargo scene #crime"];
    expect(isAboutTopic(profile(titles, { topicCategories: ["https://en.wikipedia.org/wiki/Television_program"] }), "crime")).toBe(false);
    expect(isAboutTopic(profile(titles, { description: "Our short videos are re-edited with a twist" }), "crime")).toBe(false);
    expect(isAboutTopic(profile(titles, { contentLanguage: "other" }), "crime")).toBe(false);
    expect(isAboutTopic(profile(titles, { contentLanguage: null }), "crime")).toBe(true);
  });

  it("recognizes clip channels", () => {
    expect(isClipChannel({ topicCategories: ["https://en.wikipedia.org/wiki/Film"], description: "reviews" })).toBe(false);
    expect(isClipChannel({ topicCategories: [], description: "All rights belong to the original owners" })).toBe(true);
  });
});
