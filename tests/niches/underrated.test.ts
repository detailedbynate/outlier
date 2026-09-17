import { describe, expect, it } from "vitest";
import type { NicheChannel, NicheVideo } from "@/lib/niches/analysis";
import { creatorsFor, examplesFor } from "@/lib/niches/examples";
import { findUnderratedNiches } from "@/lib/niches/underrated";

const NOW = new Date("2026-09-15T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

function channel(id: string, subscribers: number): NicheChannel {
  return { id, youtube_channel_id: `UC${id.padEnd(22, "x")}`, title: id, thumbnail_url: null, subscriber_count: subscribers };
}

function video(id: string, channelId: string, title: string, views: number, days = 10): NicheVideo {
  return {
    id,
    youtube_video_id: id.padEnd(11, "0"),
    channel_id: channelId,
    title,
    tags: [],
    format: "short",
    view_count: views,
    like_count: Math.round(views * 0.05),
    comment_count: Math.round(views * 0.01),
    published_at: daysAgo(days),
    outlier_score: 4,
  };
}

/** A niche where small channels do well, and one owned by a single giant. */
function library() {
  const channels = new Map<string, NicheChannel>([
    ["small-1", channel("small-1", 8_000)],
    ["small-2", channel("small-2", 15_000)],
    ["small-3", channel("small-3", 30_000)],
    ["small-4", channel("small-4", 20_000)],
    ["giant", channel("giant", 9_000_000)],
  ]);
  const videos = [
    ...["small-1", "small-2", "small-3", "small-4"].flatMap((id, i) =>
      Array.from({ length: 3 }, (_, n) => video(`kite-${id}-${n}`, id, `kite surfing session ${i}${n}`, 120_000 + n * 1_000, 5 + n)),
    ),
    ...Array.from({ length: 12 }, (_, n) => video(`talk-${n}`, "giant", `late night talk highlights ${n}`, 900_000, 5 + (n % 5))),
  ];
  return { videos, channels };
}

describe("findUnderratedNiches", () => {
  it("surfaces niches small channels are winning and skips the ones a giant owns", () => {
    const { videos, channels } = library();
    const found = findUnderratedNiches(videos, channels, { now: NOW, minVideos: 6, minChannels: 3, maxLibraryShare: 0.6 });

    const terms = found.map((n) => n.term);
    expect(terms.some((t) => t.includes("kite"))).toBe(true);
    expect(terms.some((t) => t.includes("talk") || t.includes("night"))).toBe(false);

    const kite = found.find((n) => n.term.includes("kite"))!;
    expect(kite.smallChannelViewShare).toBe(1);
    expect(kite.score).toBeGreaterThan(40);
    expect(kite.reason).toContain("Small channels");
  });

  it("ignores words that channels only sprinkle in", () => {
    const { videos, channels } = library();
    // Every small channel says "honestly" once; none of them is a "honestly" channel.
    const sprinkled = [
      ...videos,
      ...["small-1", "small-2", "small-3", "small-4"].map((id, i) => video(`say-${id}`, id, `honestly the wind was wild ${i}`, 130_000, 6)),
    ];
    const found = findUnderratedNiches(sprinkled, channels, { now: NOW, minVideos: 4, minChannels: 4, maxLibraryShare: 0.6 });
    expect(found.map((n) => n.term)).not.toContain("honestly");
    expect(found.some((n) => n.term.includes("kite"))).toBe(true);
  });

  it("uses niche labels even when the titles never name the niche", () => {
    const labeled = (id: string, subs: number) => ({ ...channel(id, subs), niche_terms: ["geometry dash", "geometry dash level guides"] });
    const channels = new Map([
      ["gd-1", labeled("gd-1", 9_000)],
      ["gd-2", labeled("gd-2", 14_000)],
      ["gd-3", labeled("gd-3", 22_000)],
      ["gd-4", labeled("gd-4", 31_000)],
    ]);
    const videos = [...channels.keys()].flatMap((id, i) =>
      Array.from({ length: 3 }, (_, n) => video(`gd-${id}-${n}`, id, `this took me ${i}${n} hours`, 90_000 + n * 2_000, 4 + n)),
    );
    const found = findUnderratedNiches(videos, channels, { now: NOW, maxLibraryShare: 1 });
    expect(found[0]?.term).toBe("geometry dash");
  });

  it("ignores niches with too little behind them", () => {
    const { channels } = library();
    const thin = [video("one", "small-1", "sea glass hunting", 50_000), video("two", "small-2", "sea glass hunting", 40_000)];
    expect(findUnderratedNiches(thin, channels, { now: NOW })).toEqual([]);
  });

  it("drops niches nobody watches", () => {
    const channels = new Map([["small-1", channel("small-1", 5_000)], ["small-2", channel("small-2", 6_000)], ["small-3", channel("small-3", 7_000)]]);
    const quiet = ["small-1", "small-2", "small-3"].flatMap((id, i) =>
      Array.from({ length: 3 }, (_, n) => video(`quiet-${id}-${n}`, id, `stamp collecting tips ${i}${n}`, 200, 30)),
    );
    expect(findUnderratedNiches(quiet, channels, { now: NOW, minVideos: 6, minChannels: 3, maxLibraryShare: 0.6 })).toEqual([]);
  });

  it("shows example Shorts from small channels that beat their size, one per channel", () => {
    const channels = new Map([
      ["tiny", channel("tiny", 2_000)],
      ["mid", channel("mid", 80_000)],
      ["giant", channel("giant", 5_000_000)],
    ]);
    const videos = [
      video("t1", "tiny", "tiny hit", 400_000),
      video("t2", "tiny", "tiny second", 300_000),
      video("m1", "mid", "mid hit", 900_000),
      video("g1", "giant", "giant hit", 20_000_000),
    ];
    const examples = examplesFor(videos, channels);
    // Views per subscriber: tiny 200x beats mid 11x; the giant is too big to count as proof.
    expect(examples.map((e) => e.title)).toEqual(["tiny hit", "mid hit"]);
    expect(examples[0]).toMatchObject({ youtubeVideoId: "t1".padEnd(11, "0"), channelTitle: "tiny", subscribers: 2_000, views: 400_000 });

    expect(creatorsFor(videos, channels).map((c) => [c.title, c.avgViews])).toEqual([
      ["mid", 900_000],
      ["tiny", 350_000],
    ]);
  });
});
