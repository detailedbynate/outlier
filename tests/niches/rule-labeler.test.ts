import { describe, expect, it } from "vitest";
import { CONFIDENT, labelWithRules, normalizeText, type RuleLabelInput } from "@/lib/niches/rule-labeler";

const channel = (overrides: Partial<RuleLabelInput>): RuleLabelInput => ({
  title: "Some Channel",
  description: null,
  keywords: [],
  topicCategories: [],
  uploads: [],
  ...overrides,
});

const uploads = (titles: string[], tags: string[] = []) => titles.map((title) => ({ title, tags }));

describe("rule-based niche labels", () => {
  it("names the game a channel covers, with its category and aliases", () => {
    const label = labelWithRules(
      channel({
        title: "Wubbox Central",
        uploads: uploads([
          "Epic Wubbox breeding guide #msm",
          "Rare Wubbox breeding combo explained",
          "My Singing Monsters: every Epic Wubbox ranked",
          "New island update breeding combos #mysingingmonsters",
          "Breeding the rarest monster",
        ]),
      }),
    );
    expect(label.category).toBe("Gaming");
    expect(label.primary).toMatchObject({ kind: "game", name: "My Singing Monsters", slug: "my-singing-monsters" });
    expect(label.primary?.aliases).toContain("msm");
    expect(label.subNiches[0]).toMatch(/^my singing monsters /);
    expect(label.subNiches.join(" ")).toContain("breeding");
    expect(label.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("matches hashtags written without spaces", () => {
    const label = labelWithRules(
      channel({
        uploads: uploads(["insane deck #clashroyale", "2.6 hog cycle is back #clashroyale", "evo firecracker is broken", "ladder push #clashroyale #shorts"]),
      }),
    );
    expect(label.primary?.name).toBe("Clash Royale");
  });

  it("prefers the specific game over the platform it runs on", () => {
    const label = labelWithRules(
      channel({
        title: "Fruit Hunter",
        uploads: uploads(
          ["Getting dragon fruit in Blox Fruits", "Blox Fruits trading for kitsune", "Roblox Blox Fruits update 25", "the rarest fruit in blox fruits"],
          ["roblox", "robloxfyp"],
        ),
      }),
    );
    expect(label.primary?.name).toBe("Blox Fruits");
  });

  it("doesn't read everyday words as game names", () => {
    const label = labelWithRules(
      channel({
        title: "Classic Car Revival",
        uploads: uploads(["Fixing rust on a 1968 Mustang", "Rust repair on the doors", "Paint prep after rust removal", "Welding new floor pans"]),
      }),
    );
    expect(label.primary).toMatchObject({ kind: "topic", name: "Car Restoration" });
    expect(label.category).toBe("Cars & Vehicles");
  });

  it("labels topics too, and falls back to YouTube's topic categories", () => {
    const fryer = labelWithRules(
      channel({ uploads: uploads(["Crispy air fryer wings", "Air fryer salmon in 10 minutes", "5 easy air fryer dinners", "Airfryer donuts?"]) }),
    );
    expect(fryer).toMatchObject({ category: "Food & Cooking", primary: { name: "Air Fryer Cooking", kind: "topic" } });

    const unknown = labelWithRules(
      channel({
        topicCategories: ["https://en.wikipedia.org/wiki/Tourism"],
        uploads: uploads(["Sunset over the bay", "Our last morning here", "A quiet town nobody visits"]),
      }),
    );
    expect(unknown.category).toBe("Travel & Outdoors");
    expect(unknown.confidence).toBeLessThan(CONFIDENT);
  });

  it("names a niche outside the dictionary from its most repeated phrase, as a guess", () => {
    const label = labelWithRules(
      channel({
        uploads: uploads(["Sea glass hunting on a rainy beach", "Rare red sea glass find", "Sea glass hunting after a storm", "My best sea glass haul", "Where to find sea glass"]),
      }),
    );
    expect(label.primary).toMatchObject({ kind: "topic", name: "Sea Glass" });
    expect(label.confidence).toBeLessThan(CONFIDENT);
  });

  it("leaves the game or topic empty when nothing stands out", () => {
    const label = labelWithRules(channel({ uploads: uploads(["hello", "what a day", "random stuff"]) }));
    expect(label).toMatchObject({ category: "Other", primary: null, confidence: 0.2 });
  });

  it("spots formats and quality flags", () => {
    const label = labelWithRules(
      channel({
        description: "All rights belong to the original creators. No copyright infringement intended.",
        uploads: uploads([
          "Fortnite funny moments compilation",
          "Best moments of the week",
          "Try not to laugh: Fortnite edition",
          "Fortnite fails compilation",
        ]),
      }),
    );
    expect(label.primary?.name).toBe("Fortnite");
    expect(label.flags).toEqual(expect.arrayContaining(["reupload", "compilation"]));
    expect(label.formats).toContain("compilation_clips");
  });

  it("normalizes accents and punctuation", () => {
    expect(normalizeText("Pokémon GO!!")).toBe("pokemon go");
    expect(normalizeText("  Baldur's   Gate 3 ")).toBe("baldur s gate 3");
  });
});
