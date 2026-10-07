import { describe, expect, it } from "vitest";
import type { NicheChannel, NicheVideo } from "@/lib/niches/analysis";
import { easeFor, libraryWeights, monthlyViewsOf, newcomersIn, rpmTierOf, sortDiscovered, type DiscoveredNiche } from "@/lib/niches/discover";

const NOW = new Date("2026-10-07T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function video(id: string, channel: string, views: number, age: number): NicheVideo {
  return { id, youtube_video_id: id, channel_id: channel, title: id, tags: [], format: "short", view_count: views, like_count: null, comment_count: null, published_at: daysAgo(age), outlier_score: null };
}

function channel(id: string, ageDays: number): NicheChannel {
  return { id, youtube_channel_id: id, title: `Channel ${id}`, thumbnail_url: null, subscriber_count: 500, published_at: daysAgo(ageDays) };
}

function niche(term: string, scores: DiscoveredNiche["scores"], total = 50): DiscoveredNiche {
  return { term, scores, total } as DiscoveredNiche;
}

describe("discover", () => {
  it("judges a niche by how channels under a year old did there", () => {
    const channels = new Map([
      ["a", channel("a", 60)],
      ["b", channel("b", 200)],
      ["c", channel("c", 100)],
      ["old", channel("old", 2_000)],
    ]);
    const videos = [
      video("a1", "a", 40_000, 20),
      video("a2", "a", 2_000, 10),
      video("b1", "b", 3_000, 30),
      // Too fresh to count against the channel yet.
      video("c1", "c", 50, 1),
      // An old channel's hit says nothing about starting now.
      video("o1", "old", 900_000, 20),
    ];
    const n = newcomersIn(videos, channels, "shorts", NOW);
    expect(n.channels).toBe(2);
    expect(n.hits).toBe(1);
    expect(n.best).toMatchObject({ channelTitle: "Channel a", views: 40_000, channelMonths: 2 });
  });

  it("sizes the audience from views per day, scaled up to the library", () => {
    const videos = [video("v1", "a", 70_000, 7), video("v2", "a", 3_000, 1)];
    // 10K a day for the first, a day-old upload counted as a week old: 10K + ~429 a day.
    expect(monthlyViewsOf(videos, NOW)).toBe(Math.round((10_000 + 3_000 / 7) * 30));
    expect(monthlyViewsOf(videos, NOW, () => 4)).toBe(Math.round((10_000 + 3_000 / 7) * 4 * 30));
  });

  it("weights sampled uploads by how many library uploads they stand for", () => {
    const slices = [
      { from: new Date(daysAgo(20)), to: new Date(daysAgo(10)), count: 10 },
      { from: new Date(daysAgo(10)), to: NOW, count: 100 },
    ];
    const weightOf = libraryWeights([video("a", "x", 1, 15), video("b", "x", 1, 15), video("c", "x", 1, 5)], slices);
    expect(weightOf(daysAgo(15))).toBe(5);
    expect(weightOf(daysAgo(5))).toBe(100);
    expect(weightOf(daysAgo(40))).toBe(1);
  });

  it("puts niches strong on everything ahead of ones great at one thing", () => {
    const allRound = niche("all round", { rpm: 30, views: 60, audience: 60, untapped: 60, easy: 60 }, 60);
    const oneTrick = niche("one trick", { rpm: 30, views: 99, audience: 99, untapped: 99, easy: 10 }, 70);
    const weak = niche("weak", { rpm: 30, views: 20, audience: 20, untapped: 20, easy: 20 }, 20);
    expect(sortDiscovered([oneTrick, weak, allRound], "best")[0]).toBe(oneTrick);
    expect(sortDiscovered([oneTrick, weak, allRound], "bets").map((n) => n.term)).toEqual(["all round", "one trick", "weak"]);
  });


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
