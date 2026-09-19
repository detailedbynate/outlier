import { describe, expect, it } from "vitest";
import { canonicalNiche, displayNicheName, isUsefulNiche, readsLikeAName, titleCaseNiche } from "@/lib/niches/naming";
import { tokenize, topicKey } from "@/lib/niches/analysis";

/** Titles in the ordinary mixed-case style most channels use. */
const mixed = (word: string) => [
  `Exploring the ${word} Level 2`,
  `I Survived the ${word}`,
  `This ${word} Run Went Wrong`,
  `The ${word} but Real`,
  `Playing ${word} With Friends`,
];

describe("tokenize", () => {
  it("keeps accented words whole", () => {
    // "Pokémon" used to split into "pok" and "mon", which is where "Pok Mon" came from.
    expect(tokenize("Pokémon Scarlet nuzlocke")).toEqual(["pokemon", "scarlet", "nuzlocke"]);
    expect(tokenize("Café racer build")).toContain("cafe");
  });

  it("gives an accented topic the same key as its plain spelling", () => {
    expect(topicKey("Pokémon")).toBe(topicKey("Pokemon"));
  });
});

describe("canonicalNiche", () => {
  it.each([
    ["pokemon", "Pokémon"],
    ["Pokémon", "Pokémon"],
    ["rdr2", "Red Dead Redemption 2"],
    ["red dead", "Red Dead Redemption 2"],
    // Hashtag spellings, with and without the sequel number.
    ["reddeadredemption", "Red Dead Redemption 2"],
    ["thebattlecats", "The Battle Cats"],
    ["msm", "My Singing Monsters"],
    // A word owned by exactly one known name resolves to it.
    ["mario", "Super Mario"],
  ])("%s -> %s", (term, expected) => {
    expect(canonicalNiche(term)).toBe(expected);
  });

  it.each([
    // Shared by Super Mario and Super Smash Bros.: a fragment, not a niche.
    ["super"],
    ["update"],
    ["kite surfing"],
  ])("leaves %s unknown", (term) => {
    expect(canonicalNiche(term)).toBeNull();
  });
});

describe("displayNicheName", () => {
  it.each([
    ["pokemon", "Pokémon"],
    ["funny moments", "Funny Moments"],
    ["king of the hill", "King of the Hill"],
    ["backrooms", "Backrooms"],
  ])("%s is shown as %s", (term, expected) => {
    expect(displayNicheName(term)).toBe(expected);
  });

  it("title-cases terms the dictionary doesn't know", () => {
    expect(titleCaseNiche("sea glass hunting")).toBe("Sea Glass Hunting");
  });
});

describe("readsLikeAName", () => {
  it("spots a name by how titles write it", () => {
    expect(readsLikeAName("Backrooms", mixed("Backrooms"))).toBe(true);
    expect(
      readsLikeAName("update", [
        "Blox Fruits update is Here Already",
        "New Patch update Notes Explained",
        "The update We Waited For",
        "Big update Today With Friends",
      ]),
    ).toBe(false);
  });

  it("doesn't judge channels that write everything in lower case", () => {
    // Capitalization can't mean anything here, so it isn't used as evidence.
    expect(readsLikeAName("kite", ["kite surfing session one", "kite surfing at dawn", "my best kite run", "kite tricks for beginners"])).toBe(true);
  });
});

describe("isUsefulNiche", () => {
  // Terms taken from real Niche Finder reports, where they outranked the actual niches.
  it.each(["update", "lore", "guide", "playthrough", "online", "fan", "funny", "hilarious", "getting", "super", "sea", "perm"])(
    "rejects %s",
    (term) => {
      expect(isUsefulNiche(term, { titles: mixed("Update") })).toBe(false);
    },
  );

  it("rejects the fragments a stripped accent left behind", () => {
    expect(isUsefulNiche("pok mon")).toBe(false);
  });

  it.each(["kite surfing", "sea glass hunting", "pokemon", "geometry dash", "backrooms"])("keeps %s", (term) => {
    expect(isUsefulNiche(term, { titles: mixed("Backrooms") })).toBe(true);
  });

  it("rejects a word that several known names share, even when titles capitalize it", () => {
    // "Super" is capitalized in every Super Mario title, but it names nothing by itself.
    expect(isUsefulNiche("super", { titles: mixed("Super") })).toBe(false);
    expect(isUsefulNiche("mario", { titles: mixed("Mario") })).toBe(true);
  });

  it("trusts a channel's own niche label over any of these rules", () => {
    // "battle" is filler on its own, but if the labeler called it the niche, it is one.
    expect(isUsefulNiche("battle", { labeled: new Set(["battle"]) })).toBe(true);
    expect(isUsefulNiche("battle", {})).toBe(false);
  });

  it("keeps a bare word that reads like a name, and drops one that doesn't", () => {
    expect(isUsefulNiche("shadowheart", { titles: mixed("Shadowheart") })).toBe(true);
    expect(
      isUsefulNiche("entities", {
        titles: ["All the entities Ranked Again", "New entities Are Here Now", "These entities Are Scary", "My entities Tier List"],
      }),
    ).toBe(false);
  });
});
