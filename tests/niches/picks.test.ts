import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/lib/core/logger";
import type { NicheChannel, NicheVideo } from "@/lib/niches/analysis";
import { measureGames, type GameStat } from "@/lib/niches/games";
import { choosePicks, judgePick } from "@/lib/niches/picks";
import { NicheService } from "@/lib/services/niche-service";
import type { NichePickRow, TablesInsert } from "@/types/database";

const NOW = new Date("2026-10-07T00:00:00Z");
const DAY = 86_400_000;
const at = (d: number) => new Date(NOW.getTime() + d * DAY);

let seq = 0;
const video = (channel: string, title: string, views: number, published: Date): NicheVideo => {
  seq += 1;
  return { id: `v${seq}`, youtube_video_id: `v${seq}`, channel_id: channel, title, tags: [], format: "short", view_count: views, like_count: null, comment_count: null, published_at: published.toISOString(), outlier_score: null };
};
const channel = (id: string, subscribers: number): NicheChannel => ({ id, youtube_channel_id: id, title: id, thumbnail_url: null, subscriber_count: subscribers, niche_terms: [] });

const stat = (game: string, over: Partial<GameStat> = {}): GameStat =>
  ({ game, videos: 20, channels: 6, smallChannels: 5, smallUploads: 10, newChannels: 1, medianViews: 30_000, breakoutRate: 0.4, momentum: 1, score: 70, best: null, ...over }) as GameStat;

describe("game picks", () => {
  it("writes down the top games with the numbers they were picked on", () => {
    const picks = choosePicks([stat("Doors"), stat("GTA V", { score: 60 }), stat("Fortnite")], "shorts", 2);
    expect(picks).toEqual([
      { name: "Doors", format: "shorts", score: 70, baseline: { medianViews: 30_000, breakoutRate: 0.4, channels: 6 } },
      { name: "GTA V", format: "shorts", score: 60, baseline: { medianViews: 30_000, breakoutRate: 0.4, channels: 6 } },
    ]);
  });

  it("calls a hit when one in five small-channel uploads broke out afterwards", () => {
    expect(judgePick(stat("Doors", { breakoutRate: 0.25 }))?.hit).toBe(true);
    expect(judgePick(stat("Doors", { breakoutRate: 0.1 }))?.hit).toBe(false);
    // Too few uploads, or nobody posted it: no verdict.
    expect(judgePick(stat("Doors", { smallUploads: 2 }))).toBeNull();
    expect(judgePick(undefined)).toBeNull();
  });

  it("measures a past window without the uploads that came after it", () => {
    const channels = new Map(["a", "b"].map((id) => [id, channel(id, 2_000)]));
    const videos = [video("a", "Doors floor 2 speedrun", 40_000, at(-20)), video("b", "Doors floor 2 seek chase", 40_000, at(-10)), video("a", "Doors hotel+ update", 40_000, at(5))];
    const [doors] = measureGames(videos, channels, { now: NOW, minVideos: 1, minChannels: 1 });
    expect(doors).toMatchObject({ game: "Doors", videos: 2 });
  });
});

function memoryPicks() {
  const rows: NichePickRow[] = [];
  return {
    rows,
    addPicks: vi.fn(async (insert: TablesInsert<"niche_picks">[]) => {
      let added = 0;
      for (const r of insert) {
        if (rows.some((x) => x.picked_on === r.picked_on && x.name === r.name && x.format === r.format)) continue;
        rows.push({ id: String(rows.length), kind: "game", baseline: {}, outcome: null, hit: null, scored_at: null, created_at: NOW.toISOString(), ...r } as NichePickRow);
        added += 1;
      }
      return added;
    }),
    lastPickedOn: async () => rows.map((r) => r.picked_on).sort().at(-1) ?? null,
    duePicks: async (pickedBy: string, limit: number) => rows.filter((r) => !r.scored_at && r.picked_on <= pickedBy).slice(0, limit),
    updatePick: async (id: string, patch: Partial<NichePickRow>) => {
      Object.assign(rows.find((r) => r.id === id)!, patch);
    },
    judgedPicks: async (limit: number) => rows.filter((r) => r.scored_at && r.hit !== null).slice(0, limit),
  };
}

describe("NicheService track record", () => {
  it("picks weekly, judges a month later, and keeps score", async () => {
    const channels = new Map<string, NicheChannel>();
    const videos: NicheVideo[] = [];
    // Doors: small channels keep breaking out, before and after the pick.
    for (let c = 0; c < 5; c++) {
      channels.set(`d${c}`, channel(`d${c}`, 3_000));
      for (const day of [-20, -12, -6, -2, 5, 15, 25]) videos.push(video(`d${c}`, `Doors floor 2 run ${day}`, 60_000, at(day)));
    }
    // Fortnite: crowded, small uploads go nowhere.
    for (let c = 0; c < 5; c++) {
      channels.set(`f${c}`, channel(`f${c}`, 3_000));
      for (const day of [-20, -12, -6, -2, 5, 15, 25]) videos.push(video(`f${c}`, `Fortnite zero build ${day}`, 1_500, at(day)));
    }
    const niches = { recentSample: vi.fn(async (since: Date) => ({ videos: videos.filter((v) => Date.parse(v.published_at) >= since.getTime()), channels })) };
    const picks = memoryPicks();
    const make = () => new NicheService({ niches, picks } as never, {}, createLogger());

    const service = make();
    // Only what was out on the day of the pick counts towards it.
    const before = videos.splice(0, videos.length);
    videos.push(...before.filter((v) => Date.parse(v.published_at) <= NOW.getTime()));
    const first = await service.trackPicksOnce({ now: NOW });
    expect(first?.picked).toBeGreaterThan(0);
    expect(picks.rows.map((r) => r.name)).toContain("Doors");
    // Same day: nothing to do. A restart a few days later doesn't pick again.
    expect(await service.trackPicksOnce({ now: at(0.5) })).toBeNull();
    expect(await make().trackPicksOnce({ now: at(3) })).toEqual({ picked: 0, judged: 0 });
    expect(await service.trackRecord()).toEqual({ judged: 0, hits: 0, picks: [] });

    // Five weeks on, the month after the pick is in.
    videos.splice(0, videos.length, ...before);
    const later = make();
    const result = await later.trackPicksOnce({ now: at(38) });
    expect(result?.judged).toBeGreaterThan(0);
    const doors = picks.rows.find((r) => r.name === "Doors" && r.picked_on === "2026-10-07")!;
    expect(doors).toMatchObject({ hit: true });
    expect(doors.outcome).toMatchObject({ smallUploads: 15 });
    const record = await later.trackRecord();
    expect(record.hits).toBeGreaterThan(0);
    expect(record.judged).toBeGreaterThanOrEqual(record.hits);
  });

  it("has no record without somewhere to keep it", async () => {
    const service = new NicheService({ niches: { recentSample: vi.fn() } } as never, {}, createLogger());
    expect(await service.trackPicksOnce({ now: NOW })).toBeNull();
    expect(await service.trackRecord()).toEqual({ judged: 0, hits: 0, picks: [] });
  });
});
