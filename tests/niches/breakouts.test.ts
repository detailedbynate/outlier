import { describe, expect, it } from "vitest";
import type { NicheChannel, NicheVideo } from "@/lib/niches/analysis";
import { findBreakouts } from "@/lib/niches/breakouts";

const NOW = new Date("2026-10-07T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function video(id: string, channel: string, title: string, views: number, published = daysAgo(3)): NicheVideo {
  return { id, youtube_video_id: id, channel_id: channel, title, tags: [], format: "long_form", view_count: views, like_count: null, comment_count: null, published_at: published, outlier_score: null };
}

function channel(id: string, title: string, subscribers: number | null, niche_terms?: string[]): NicheChannel {
  return { id, youtube_channel_id: id, title, thumbnail_url: null, subscriber_count: subscribers, niche_terms };
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
