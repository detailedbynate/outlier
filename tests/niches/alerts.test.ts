import { describe, expect, it } from "vitest";
import { gameAlert } from "@/lib/niches/alerts";
import type { GameStat } from "@/lib/niches/games";

const stat = (over: Partial<GameStat> = {}): GameStat =>
  ({ game: "Doors", videos: 20, channels: 6, smallChannels: 5, smallUploads: 10, newChannels: 0, medianViews: 20_000, breakoutRate: 0.1, momentum: null, score: 50, best: null, ...over }) as GameStat;

describe("alerts on saved games", () => {
  it("flags a game warming up", () => {
    expect(gameAlert(stat({ momentum: 0.6, breakoutRate: 0.4 }), false)).toEqual({ tone: "up", text: "Views up 60% in two weeks · 40% of small-channel uploads breaking out" });
    expect(gameAlert(undefined, true)).toEqual({ tone: "up", text: "Taking off on Steam or Roblox, little on YouTube yet" });
  });

  it("flags one cooling off, and mixed signals as neither", () => {
    expect(gameAlert(stat({ momentum: -0.4 }), false)).toEqual({ tone: "down", text: "Views down 40% in two weeks" });
    expect(gameAlert(stat({ momentum: -0.4 }), true)?.tone).toBe("flat");
  });

  it("says how it's doing when nothing moved, and nothing without data", () => {
    expect(gameAlert(stat(), false)).toEqual({ tone: "flat", text: "10 small-channel uploads in four weeks, 10% broke out" });
    expect(gameAlert(undefined, false)).toBeNull();
  });
});

describe("NicheService followed games", () => {
  it("finds saved games in the library, even ones too small for the top list", async () => {
    const { NicheService } = await import("@/lib/services/niche-service");
    const { createLogger } = await import("@/lib/core/logger");
    const now = new Date("2026-10-07T00:00:00Z");
    const channels = new Map(["a", "b"].map((id) => [id, { id, youtube_channel_id: id, title: id, thumbnail_url: null, subscriber_count: 2_000, niche_terms: [] }]));
    const videos = ["a", "b", "a"].map((channel, i) => ({
      id: `v${i}`, youtube_video_id: `v${i}`, channel_id: channel, title: `Doors floor 2 run ${i}`, tags: [], format: "short", view_count: 30_000,
      like_count: null, comment_count: null, published_at: new Date(now.getTime() - (i + 1) * 86_400_000).toISOString(), outlier_score: null,
    }));
    const service = new NicheService({ niches: { recentSample: async () => ({ videos, channels }) } } as never, {}, createLogger());
    const followed = await service.followedGames(["doors floor 2", "personal finance", "minecraft"], "shorts", { now });
    expect(followed.get("doors floor 2")).toMatchObject({ game: "Doors", smallUploads: 3 });
    expect(followed.has("minecraft")).toBe(true);
    expect(followed.get("minecraft")).toBeUndefined();
    expect(followed.has("personal finance")).toBe(false);
  });
});
