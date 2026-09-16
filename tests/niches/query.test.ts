import { describe, expect, it } from "vitest";
import { parseNicheQuery } from "@/lib/niches/query";

describe("parseNicheQuery", () => {
  it("takes a plain topic as-is", () => {
    expect(parseNicheQuery("fitness")).toEqual({ intent: "research", topic: "fitness" });
    expect(parseNicheQuery("  Personal Finance  ")).toEqual({ intent: "research", topic: "personal finance" });
  });

  it("pulls the topic out of a question", () => {
    expect(parseNicheQuery("good niches around fitness")).toMatchObject({ intent: "research", topic: "fitness" });
    expect(parseNicheQuery("What are the best niches for gaming?")).toMatchObject({ intent: "research", topic: "gaming" });
    expect(parseNicheQuery("show me niche ideas about home cooking")).toMatchObject({ intent: "research", topic: "home cooking" });
    expect(parseNicheQuery("what should I post about in tech")).toMatchObject({ intent: "research", topic: "tech" });
  });

  it("browses when no topic was named", () => {
    for (const input of ["", "top niches", "best niches right now", "what are the top niches?", "show me some ideas"]) {
      expect(parseNicheQuery(input)).toEqual({ intent: "browse", topic: null });
    }
  });
});
