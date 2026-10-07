import { describe, expect, it } from "vitest";
import type { NicheChannel, NicheVideo } from "@/lib/niches/analysis";
import { measureGames } from "@/lib/niches/games";
import { gameIn } from "@/lib/niches/rule-labeler";

const NOW = new Date("2026-10-07T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const video = (id: string, channel: string, title: string, views: number, days = 3): NicheVideo => ({
  id,
  youtube_video_id: id,
  channel_id: channel,
  title,
  tags: [],
  format: "short",
  view_count: views,
  like_count: null,
  comment_count: null,
  published_at: daysAgo(days),
  outlier_score: null,
});

const channel = (id: string, subscribers: number, terms: string[] = []): NicheChannel => ({ id, youtube_channel_id: id, title: id, thumbnail_url: null, subscriber_count: subscribers, niche_terms: terms });

describe("which game a title is about", () => {
  it("prefers the game inside the platform", () => {
    expect(gameIn("Blox Fruits update 25 #roblox")).toBe("Blox Fruits");
    expect(gameIn("my roblox obby")).toBe("Roblox");
    expect(gameIn("how to file taxes")).toBeNull();
  });
});

describe("games with room", () => {
  it("ranks a game small channels win in above a crowded one", () => {
    const channels = new Map<string, NicheChannel>();
    const videos: NicheVideo[] = [];
    // Helldivers: five small channels, every upload pulls 10x their size.
    for (let c = 0; c < 5; c++) {
      channels.set(`h${c}`, channel(`h${c}`, 5_000));
      for (let i = 0; i < 3; i++) videos.push(video(`h${c}${i}`, `h${c}`, `Helldivers 2 best loadout ${i}`, 50_000, 2 + i * 6));
    }
    // Fortnite: forty channels, uploads do a fraction of their size.
    for (let c = 0; c < 40; c++) {
      channels.set(`f${c}`, channel(`f${c}`, 50_000));
      videos.push(video(`f${c}`, `f${c}`, "Fortnite chapter 6 tips", 8_000, 5));
    }
    // A finance channel mentioning a game doesn't count for it.
    channels.set("fin", channel("fin", 5_000, ["personal finance"]));
    for (let i = 0; i < 20; i++) videos.push(video(`m${i}`, "fin", `What Fortnite teaches about money ${i}`, 90_000));

    const [first, second] = measureGames(videos, channels, { now: NOW });
    expect(first).toMatchObject({ game: "Helldivers 2", channels: 5, breakoutRate: 1 });
    expect(second).toMatchObject({ game: "Fortnite", channels: 40, breakoutRate: 0 });
    expect(first!.score).toBeGreaterThan(second!.score);
    expect(first!.best).toMatchObject({ views: 50_000 });
  });
});
