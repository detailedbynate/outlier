import { describe, expect, it, vi } from "vitest";
import { computeNicheMetrics, type SubNiche } from "@/lib/niches/analysis";
import { refineSubNiches } from "@/lib/niches/refine";

const sub = (term: string): SubNiche => ({
  term,
  metrics: computeNicheMetrics([], new Map()),
  examples: [{ youtubeVideoId: `id-${term}`, title: `${term} video`, channelTitle: "c", views: 1, subscribers: null, publishedAt: "2026-09-01T00:00:00Z" }],
});

describe("refineSubNiches", () => {
  it("drops what the model rejects, renames the rest, and never adds", async () => {
    const generateObject = vi.fn().mockResolvedValue({
      object: {
        niches: [
          { index: 0, keep: false, name: "Lobby" },
          { index: 1, keep: true, name: "Tears of the Kingdom" },
          { index: 2, keep: true, name: "Tears of the Kingdom" },
          { index: 9, keep: true, name: "Invented" },
        ],
      },
    });
    const out = await refineSubNiches({ generateObject }, "zelda", [sub("Lobby"), sub("Totk Zelda"), sub("Zeldatotk"), sub("Skyward Sword")]);
    // The duplicate rename collapses; the one the model skipped keeps its mined name.
    expect(out.map((s) => s.term)).toEqual(["Tears of the Kingdom", "Skyward Sword"]);
    const prompt = generateObject.mock.calls[0]![0].messages[0].content as string;
    expect(prompt).toContain("Topic: zelda");
    expect(prompt).toContain("Totk Zelda video");
  });

  it("skips the call when there is nothing to name", async () => {
    const generateObject = vi.fn();
    expect(await refineSubNiches({ generateObject }, "x", [])).toEqual([]);
    expect(generateObject).not.toHaveBeenCalled();
  });
});
