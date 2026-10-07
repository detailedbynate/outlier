import { describe, expect, it } from "vitest";
import { mineFirst, nichePreferences } from "@/lib/niches/personal";

describe("niche finder preferences", () => {
  it("starts a long-form gaming creator on long-form games, theirs first", () => {
    expect(nichePreferences({ contentFormats: ["long_form"], niches: ["Minecraft", "GTA 6", "Commentary"] })).toEqual({ format: "long_form", lens: "gaming", games: ["Minecraft", "GTA VI"] });
  });

  it("starts a creator with no gaming topics on all niches", () => {
    expect(nichePreferences({ contentFormats: ["shorts", "long_form"], niches: ["Finance", "AI"] })).toEqual({ format: null, lens: "all", games: [] });
    expect(nichePreferences({ contentFormats: ["shorts"], niches: ["Gaming"] })).toMatchObject({ format: "shorts", lens: "gaming" });
  });

  it("leaves the defaults alone when it can't tell", () => {
    expect(nichePreferences(null)).toEqual({ format: null, lens: null, games: [] });
    expect(nichePreferences({ contentFormats: [], niches: ["Commentary"] })).toEqual({ format: null, lens: null, games: [] });
  });

  it("puts the creator's games first and keeps the rest in order", () => {
    const games = [{ game: "Doors" }, { game: "Minecraft" }, { game: "Fortnite" }, { game: "GTA VI" }];
    expect(mineFirst(games, ["GTA VI", "Minecraft"], (g) => g.game).map((g) => g.game)).toEqual(["Minecraft", "GTA VI", "Doors", "Fortnite"]);
  });
});
