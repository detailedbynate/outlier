import { describe, expect, it } from "vitest";
import type { NicheChannel, NicheVideo } from "@/lib/niches/analysis";
import { FORMATS, measureFormats } from "@/lib/niches/formats";

const video = (id: string, channel: string, title: string, views: number): NicheVideo => ({
  id,
  youtube_video_id: id,
  channel_id: channel,
  title,
  tags: [],
  format: "short",
  view_count: views,
  like_count: null,
  comment_count: null,
  published_at: "2026-10-01T00:00:00Z",
  outlier_score: null,
});

const channel = (id: string, terms: string[], subscribers = 10_000): NicheChannel => ({ id, youtube_channel_id: id, title: id, thumbnail_url: null, subscriber_count: subscribers, niche_terms: terms });

describe("formats working right now", () => {
  it("knows the formats by their titles, and not the look-alikes", () => {
    const match = (title: string) => FORMATS.filter((f) => f.pattern.test(title)).map((f) => f.id);
    expect(match("Ranking every budgeting app")).toContain("ranking");
    expect(match("Climbing ranked in Valorant")).not.toContain("ranking");
    expect(match("Roth IRA vs 401k")).toContain("versus");
    expect(match("7 apps that make budgeting automatic")).toContain("numbered");
  });

  it("scores formats against a typical upload and says where they're missing", () => {
    const channels = new Map<string, NicheChannel>();
    const videos: NicheVideo[] = [];
    for (let c = 0; c < 6; c++) {
      channels.set(`g${c}`, channel(`g${c}`, ["minecraft"]));
      channels.set(`f${c}`, channel(`f${c}`, ["budgeting"]));
      for (let i = 0; i < 4; i++) {
        // Rankings do 5x a typical upload, all in gaming.
        videos.push(video(`g${c}-${i}`, `g${c}`, `Ranking every Minecraft mob ${i}`, 50_000));
        videos.push(video(`g${c}-p${i}`, `g${c}`, `Minecraft let's play ${i}`, 10_000));
        videos.push(video(`f${c}-${i}`, `f${c}`, `Budgeting update ${i}`, 10_000));
      }
    }
    // A giant's rankings don't count: the point is what works for small channels.
    channels.set("big", channel("big", ["minecraft"], 5_000_000));
    for (let i = 0; i < 20; i++) videos.push(video(`big-${i}`, "big", `Ranking the best seeds ${i}`, 100));

    const [ranking, ...rest] = measureFormats(videos, channels);
    expect(rest).toHaveLength(0);
    expect(ranking).toMatchObject({ id: "ranking", videos: 24, channels: 6, medianLift: 5, edge: 5, topCategories: ["Gaming"] });
    expect(ranking!.openIn).toContain("Finance & Business");
    expect(ranking!.best).toMatchObject({ views: 50_000 });
  });
});
