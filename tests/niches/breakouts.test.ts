import { describe, expect, it } from "vitest";
import type { NicheChannel, NicheVideo } from "@/lib/niches/analysis";
import { findBreakouts, findRisingChannels } from "@/lib/niches/breakouts";

const NOW = new Date("2026-10-07T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function video(id: string, channel: string, title: string, views: number, published = daysAgo(3)): NicheVideo {
  return { id, youtube_video_id: id, channel_id: channel, title, tags: [], format: "long_form", view_count: views, like_count: null, comment_count: null, published_at: published, outlier_score: null };
}

function channel(id: string, title: string, subscribers: number | null, niche_terms?: string[], published_at: string | null = null): NicheChannel {
  return { id, youtube_channel_id: id, title, thumbnail_url: null, subscriber_count: subscribers, niche_terms, published_at };
}

describe("breakouts in paying niches", () => {
  const channels = new Map([
    ["fin", channel("fin", "Money Notes", 4_000, ["roth ira"])],
    ["game", channel("game", "Blocky", 3_000, ["minecraft"])],
    ["big", channel("big", "Huge Finance", 2_000_000)],
    ["diy", channel("diy", "Fix It", 2_000, ["hvac"])],
    ["gta", channel("gta", "Crime City", 5_000, ["gta 5"])],
  ]);

  it("keeps small channels beating their size in categories that pay", () => {
    const found = findBreakouts(
      [
        video("a", "fin", "Roth IRA mistakes nobody tells you", 80_000),
        video("b", "game", "Minecraft but every block is TNT", 900_000),
        video("c", "big", "Roth IRA explained", 3_000_000),
        video("d", "fin", "Old roth ira video", 500_000, daysAgo(40)),
        video("e", "diy", "HVAC filter hack", 30_000),
        // The title says car, the channel's labels say game.
        video("f", "gta", "My car got stolen in GTA", 400_000),
      ],
      channels,
      { now: NOW },
    );
    expect(found.map((b) => b.youtubeVideoId)).toEqual(["a"]);
    expect(found[0]).toMatchObject({ category: "Finance & Business", lift: 20 });
  });

  it("trusts an unlabeled channel's topic only when most of its uploads agree", () => {
    const unlabeled = new Map([
      ["meme", channel("meme", "Daily Laughs", 3_000)],
      ["tax", channel("tax", "Tax Guy", 3_000)],
    ]);
    const found = findBreakouts(
      [
        video("m1", "meme", "Making too much money from YouTube", 400_000),
        video("m2", "meme", "When the teacher walks in", 50_000),
        video("m3", "meme", "My dog vs the vacuum", 50_000),
        video("t1", "tax", "Tax refund mistakes", 90_000),
        video("t2", "tax", "Tax brackets explained", 20_000),
        video("t3", "tax", "Weekend vlog", 5_000),
        // Money words in a meme are still a meme.
        video("t4", "tax", "Tax season meme #funny", 900_000),
      ],
      unlabeled,
      { now: NOW },
    );
    expect(found.map((b) => b.youtubeVideoId)).toEqual(["t1"]);
  });

  it("shows one video per channel and ranks pay with lift", () => {
    const tech = new Map([...channels, ["tech", channel("tech", "Sheets Pro", 1_000, ["excel formulas"])]]);
    const found = findBreakouts(
      [
        video("a", "fin", "Roth IRA mistakes", 40_000),
        video("a2", "fin", "Roth IRA limits", 60_000),
        video("t", "tech", "Excel formulas you need", 90_000),
      ],
      tech,
      { now: NOW },
    );
    expect(found.map((b) => b.youtubeVideoId)).toEqual(["t", "a2"]);
  });
});

describe("new channels already winning", () => {
  it("finds young channels whose typical upload does well in categories that pay", () => {
    const channels = new Map([
      ["new", channel("new", "Budget Lab", 8_000, ["budgeting"], daysAgo(60))],
      ["old", channel("old", "Old Money", 8_000, ["budgeting"], daysAgo(2_000))],
      ["lucky", channel("lucky", "One Hit", 8_000, ["budgeting"], daysAgo(30))],
      ["game", channel("game", "Blocky", 8_000, ["minecraft"], daysAgo(30))],
    ]);
    const uploads = (ch: string, views: number[]) => views.map((v, i) => video(`${ch}${i}`, ch, `Budget tip ${i}`, v, daysAgo(i + 1)));
    const found = findRisingChannels(
      [...uploads("new", [20_000, 15_000, 30_000]), ...uploads("old", [50_000, 50_000, 50_000]), ...uploads("lucky", [900_000, 800, 600]), ...uploads("game", [90_000, 90_000, 90_000])],
      channels,
      { now: NOW },
    );
    expect(found.map((c) => c.title)).toEqual(["Budget Lab"]);
    expect(found[0]).toMatchObject({ ageDays: 60, uploads: 3, medianViews: 20_000, category: "Finance & Business", top: { youtubeVideoId: "new2", views: 30_000 } });
  });
});

describe("the gaming lens", () => {
  const channels = new Map([
    ["fin", channel("fin", "Money Notes", 4_000, ["roth ira"])],
    ["mc", channel("mc", "Blocky", 3_000, ["minecraft"])],
    ["bf", channel("bf", "Fruit Hunter", 6_000, ["roblox", "blox fruits"])],
    ["mario", channel("mario", "Plumber Zone", 3_000, ["super mario"])],
    ["fresh", channel("fresh", "New Blocks", 9_000, ["minecraft"], daysAgo(60))],
  ]);

  it("keeps gaming only, ranks on views, and names the game", () => {
    const found = findBreakouts(
      [
        video("a", "fin", "Roth IRA mistakes nobody tells you", 80_000),
        video("b", "mc", "Minecraft but every block is TNT", 900_000),
        video("c", "bf", "Blox Fruits update 25 secrets", 400_000),
        // A gaming channel's movie video isn't a gaming breakout.
        video("d", "mario", "The dumbest moment in every Star Wars movie", 500_000),
      ],
      channels,
      { now: NOW, lens: "gaming" },
    );
    expect(found.map((b) => [b.youtubeVideoId, b.game])).toEqual([
      ["b", "Minecraft"],
      ["c", "Blox Fruits"],
    ]);
  });

  it("finds new gaming channels and the game they picked", () => {
    const uploads = [1, 2, 3, 4].map((i) => video(`n${i}`, "fresh", `Minecraft hardcore day ${i}`, 60_000));
    const found = findRisingChannels(uploads, channels, { now: NOW, lens: "gaming" });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ title: "New Blocks", game: "Minecraft" });
    // The paying lens leaves it out.
    expect(findRisingChannels(uploads, channels, { now: NOW })).toHaveLength(0);
  });
});
