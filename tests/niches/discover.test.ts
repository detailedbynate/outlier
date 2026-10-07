import { describe, expect, it } from "vitest";
import { easeFor, rpmTierOf } from "@/lib/niches/discover";

describe("discover", () => {
  it("tiers RPM per format", () => {
    expect(rpmTierOf([8, 20], "long_form")).toBe("high");
    expect(rpmTierOf([1, 3], "long_form")).toBe("low");
    expect(rpmTierOf([0.08, 0.25], "shorts")).toBe("high");
    expect(rpmTierOf([0.01, 0.04], "shorts")).toBe("low");
  });

  it("rates faceless formats easier than filmed ones", () => {
    const facts = easeFor("history facts", "Education & Explainers", "shorts", null);
    const travel = easeFor("van life", "Travel & Outdoors", "long_form", 25);
    expect(facts.score).toBeGreaterThan(travel.score);
    expect(travel.note).toMatch(/filming/);
  });
});
