import { describe, expect, it } from "vitest";
import { buildLabelPrompt, nicheSlug, normalizeLabel, topicName, type RawChannelLabel } from "@/lib/niches/labeling";

const raw = (overrides: Partial<RawChannelLabel> = {}): RawChannelLabel => ({
  ref: "c1",
  category: "Gaming",
  primary_kind: "game",
  primary_name: "  My Singing Monsters ",
  aliases: ["MSM", "msm", "My Singing Monsters", "x"],
  sub_niches: ["MSM breeding combos", "msm breeding combos", "My Singing Monsters", "wubbox rarities", "ok"],
  formats: ["tutorial_guide", "tutorial_guide", "gameplay", "tier_list_ranking", "commentary"],
  flags: ["non_english", "non_english"],
  confidence: 1.4,
  ...overrides,
});

describe("niche labels", () => {
  it("tidies names, drops duplicates and repeats of the primary, and clamps confidence", () => {
    expect(normalizeLabel(raw())).toEqual({
      category: "Gaming",
      primary: { kind: "game", name: "My Singing Monsters", slug: "my-singing-monsters", aliases: ["msm"] },
      subNiches: ["msm breeding combos", "wubbox rarities"],
      formats: ["tutorial_guide", "gameplay", "tier_list_ranking"],
      flags: ["non_english"],
      confidence: 1,
    });
  });

  it("rejects labels without a usable name", () => {
    expect(normalizeLabel(raw({ primary_name: "   " }))).toBeNull();
    expect(normalizeLabel(raw({ primary_name: "!!" }))).toBeNull();
    expect(normalizeLabel(raw({ confidence: Number.NaN }))?.confidence).toBe(0);
  });

  it("makes slugs the niches table accepts", () => {
    expect(nicheSlug("Pokémon Scarlet & Violet")).toBe("pokemon-scarlet-violet");
    expect(nicheSlug("  --Clash   Royale-- ")).toBe("clash-royale");
    expect(nicheSlug("Food & Cooking")).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("reads YouTube topic URLs", () => {
    expect(topicName("https://en.wikipedia.org/wiki/Action-adventure_game")).toBe("Action-adventure game");
    expect(topicName("https://en.wikipedia.org/wiki/Pok%C3%A9mon")).toBe("Pokémon");
  });

  it("summarizes each channel with its ref and trims long fields", () => {
    const prompt = buildLabelPrompt([
      {
        ref: "c1",
        title: "Wubbox Central",
        description: "x".repeat(900),
        keywords: ["msm"],
        topicCategories: ["https://en.wikipedia.org/wiki/Video_game_culture"],
        subscriberCount: 12_000,
        recentTitles: ["Epic Wubbox breeding guide"],
        recentTags: ["my singing monsters"],
      },
      { ref: "c2", title: "Empty", description: null, keywords: [], topicCategories: [], subscriberCount: null, recentTitles: [], recentTags: [] },
    ]);
    expect(prompt).toContain("Label these 2 channels.");
    expect(prompt).toContain("ref: c1");
    expect(prompt).toContain("youtube topics: Video game culture");
    expect(prompt).toContain("  - Epic Wubbox breeding guide");
    expect(prompt).toContain("recent uploads: none stored");
    expect(prompt).not.toContain("x".repeat(401));
  });
});
