import { describe, expect, it } from "vitest";
import { keywordTokens, mentionsKeywords, normalizeText } from "@/lib/research/relevance";

describe("keyword relevance", () => {
  it("drops filler words from the search", () => {
    expect(keywordTokens("My Singing Monsters")).toEqual(["singing", "monsters"]);
    expect(keywordTokens("best cooking tips")).toEqual(["cooking"]);
    // Nothing meaningful left: keep what was typed.
    expect(keywordTokens("how to")).toEqual(["how", "to"]);
  });

  it("matches only when every keyword appears", () => {
    const tokens = keywordTokens("my singing monsters");
    expect(mentionsKeywords("MSM update! my singing monsters wave 5", tokens)).toBe(true);
    expect(mentionsKeywords("Singing my heart out", tokens)).toBe(false);
    expect(mentionsKeywords("Monsters Inc explained", tokens)).toBe(false);
  });

  it("ignores case and punctuation", () => {
    expect(normalizeText("My Singing Monsters!!")).toBe("my singing monsters");
    expect(mentionsKeywords("MY-SINGING-MONSTERS", keywordTokens("singing monsters"))).toBe(true);
  });
});
