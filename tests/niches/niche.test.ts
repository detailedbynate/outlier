import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/lib/core/logger";
import { buildNicheReport, computeNicheMetrics, discoverSubNiches, topicKey, type NicheChannel, type NicheVideo } from "@/lib/niches/analysis";
import { NicheService, NICHE_REFRESH_EVENT } from "@/lib/services/niche-service";
import { QuotaUnavailableError } from "@/lib/youtube/quota-manager";
import type { NicheReportRow } from "@/types/database";
import { makeChannel, makeVideo } from "../helpers/fixtures";

const NOW = new Date("2026-09-19T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

let seq = 0;
function video(overrides: Partial<NicheVideo> & { channel: string; title: string }): NicheVideo {
  seq += 1;
  const { channel, ...rest } = overrides;
  return {
    id: `v${seq}`,
    youtube_video_id: `yt${String(seq).padStart(9, "0")}`,
    channel_id: channel,
    tags: [],
    format: "short",
    view_count: 10_000,
    like_count: 500,
    comment_count: 20,
    published_at: daysAgo(10),
    outlier_score: null,
    ...rest,
  };
}

function channelMap(ids: string[], subs = 50_000): Map<string, NicheChannel> {
  return new Map(ids.map((id) => [id, { id, youtube_channel_id: `UC${id}`, title: `Channel ${id}`, thumbnail_url: null, subscriber_count: subs }]));
}

/** Gaming sample: minecraft (4 channels) and roblox (3 channels) sub-niches. */
function gamingSample(): NicheVideo[] {
  const rows: NicheVideo[] = [];
  for (const ch of ["a", "b", "c", "d"]) {
    for (let i = 0; i < 4; i++) rows.push(video({ channel: ch, title: `Minecraft survival build part ${i} #gaming`, view_count: 20_000 + i * 1_000, published_at: daysAgo(3 + i * 12) }));
  }
  for (const ch of ["e", "f", "g"]) {
    for (let i = 0; i < 3; i++) {
      rows.push(video({ channel: ch, title: "Roblox obby funny moments gaming", view_count: 5_000 * (i + 1), format: i === 0 ? "long_form" : "short", published_at: daysAgo(5 + i * 10) }));
    }
  }
  return rows;
}

describe("niche analysis", () => {
  it("normalizes topic keys", () => {
    expect(topicKey("  Personal   FINANCE!! ")).toBe("personal finance");
  });

  it("discovers sub-niches shared across channels, without the topic word or noise", () => {
    const subs = discoverSubNiches(gamingSample(), "gaming").map((s) => s.term);
    expect(subs).toContain("minecraft");
    expect(subs).toContain("roblox");
    expect(subs).not.toContain("gaming");
    expect(subs).not.toContain("part");
    expect(subs.some((t) => t.startsWith("game"))).toBe(false);
    // Overlapping terms collapse into one sub-niche.
    expect(subs.filter((t) => t.includes("minecraft"))).toHaveLength(1);
  });

  it("ignores joined and stemmed forms of the topic", () => {
    const rows = ["a", "b", "c"].flatMap((ch) => [
      video({ channel: ch, title: "clashroyale emotes deck" }),
      video({ channel: ch, title: "Clash Royale ladder push tips" }),
    ]);
    const subs = discoverSubNiches(rows, "clash royale").map((s) => s.term);
    expect(subs).not.toContain("clashroyale");
    expect(subs.some((t) => t.includes("emotes"))).toBe(true);
  });

  it("computes demand, growth, competition, viral frequency, format, leaders, and breakouts", () => {
    const rows = [
      video({ channel: "big", title: "x", view_count: 1_000_000, published_at: daysAgo(40), outlier_score: 1 }),
      video({ channel: "big", title: "x", view_count: 900_000, published_at: daysAgo(50), outlier_score: 1 }),
      video({ channel: "big", title: "x", view_count: 800_000, published_at: daysAgo(45), outlier_score: 1 }),
      video({ channel: "small", title: "breakout", view_count: 600_000, published_at: daysAgo(5), outlier_score: 12 }),
      video({ channel: "small", title: "y", view_count: 50_000, published_at: daysAgo(3), outlier_score: 1 }),
      video({ channel: "small", title: "z", view_count: 40_000, published_at: daysAgo(2), outlier_score: 1 }),
      video({ channel: "long", title: "long", format: "long_form", view_count: 5_000, published_at: daysAgo(20) }),
    ];
    const channels = new Map([...channelMap(["big", "long"], 5_000_000), ...channelMap(["small"], 20_000)]);
    const m = computeNicheMetrics(rows, channels, NOW);
    expect(m).toMatchObject({ videos: 7, channels: 3, activeChannels: 2, uploads30d: 4, competition: "high" });
    expect(m.viralRate).toBeCloseTo(1 / 6, 2);
    expect(m.smallChannelShare).toBe(1);
    expect(m.format.best).toBe("shorts");
    expect(m.topChannels[0]!.title).toBe("Channel big");
    expect(m.breakouts[0]).toMatchObject({ title: "breakout", multiplier: 12 });
    expect(m.opportunity).toBeGreaterThan(0);
    expect(m.opportunity).toBeLessThanOrEqual(100);
  });

  it("builds a report sorted by opportunity and handles empty data", () => {
    const report = buildNicheReport("gaming", gamingSample(), channelMap(["a", "b", "c", "d", "e", "f", "g"]), NOW);
    const scores = report.subNiches.map((s) => s.metrics.opportunity);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    const empty = buildNicheReport("nothing", [], new Map(), NOW);
    expect(empty.overall).toMatchObject({ videos: 0, confidence: "low" });
    expect(empty.subNiches).toEqual([]);
  });
});

describe("NicheService (database-first)", () => {
  function setup(options: { sampleVideos?: NicheVideo[]; searchError?: Error; ai?: { generateObject: ReturnType<typeof vi.fn> } } = {}) {
    let stored: NicheReportRow | null = null;
    let claimed = false;
    let sample = options.sampleVideos ?? [];
    const niches = {
      getReport: vi.fn(async () => stored),
      saveReport: vi.fn(async (row: Partial<NicheReportRow>) => {
        stored = { ...(stored ?? ({} as NicheReportRow)), ...row } as NicheReportRow;
      }),
      claimRefresh: vi.fn(async () => {
        if (claimed || stored?.youtube_refreshed_at) return false;
        claimed = true;
        return true;
      }),
      releaseClaim: vi.fn(async () => {
        claimed = false;
      }),
      topicSample: vi.fn(async () => ({ videos: sample, channels: channelMap([...new Set(sample.map((v) => v.channel_id))]) })),
      popularTopics: vi.fn(async () => []),
    };
    const youtube = {
      searchVideos: vi.fn(async () => {
        if (options.searchError) throw options.searchError;
        return {
          items: [makeVideo({ id: "search00001", channelId: "UCnewchannel0000000000aa", views: 90_000 })],
          nextPageToken: null,
          prevPageToken: null,
          totalResults: 1,
        };
      }),
      getChannels: vi.fn(async (ids: readonly string[]) => ids.map((id) => makeChannel({ id }))),
    };
    const usage = { record: vi.fn(async () => ({}) as never), countSince: vi.fn(async () => 0) };
    const channels = {
      upsertMany: vi.fn(async (rows: { youtube_channel_id: string }[]) => {
        // Stored data is rich enough once the fetched results are saved.
        sample = gamingSample();
        return rows.map((r, i) => ({ ...r, id: `uuid-${i}` })) as never;
      }),
    };
    const videos = { upsertMany: vi.fn(async () => []) };
    const credits = {
      status: vi.fn(async () => ({ used: 0, limit: 100, remaining: 100, resetsAt: "" })),
      charge: vi.fn(async () => ({ charged: 5 })),
    };
    const enqueue = vi.fn(async () => ({}));
    const service = new NicheService(
      { niches, youtube, channels, videos, usage, credits, enqueue, ai: options.ai } as never,
      { minVideos: 20, minChannels: 5 },
      createLogger(),
    );
    return { service, youtube, niches, usage, credits, channels, videos, enqueue };
  }

  it("answers from stored data without calling YouTube when the sample is rich enough", async () => {
    const { service, youtube } = setup({ sampleVideos: gamingSample() });
    const result = await service.research("Gaming", { userId: "u1", now: NOW });
    expect(result).toMatchObject({ source: "database", unitsSpent: 0, stale: false });
    expect(result.report.subNiches.length).toBeGreaterThan(0);
    expect(youtube.searchVideos).not.toHaveBeenCalled();
  });

  it("lets the AI plan extra searches for a topic with no data, and keeps its related words", async () => {
    const ai = {
      generateObject: vi.fn(async () => ({
        object: { queries: ["stoic philosophy", "Marcus Aurelius lessons", "one too many"], related: ["Stoic", "marcus aurelius", "stoicism"] },
        model: "test",
        usage: {},
      })),
    };
    const { service, youtube, niches } = setup({ ai });
    const result = await service.research("stoicism", { userId: "u1", now: NOW });
    expect((youtube.searchVideos.mock.calls as unknown as [{ q: string }][]).map(([params]) => params.q)).toEqual(["stoicism", "stoic philosophy", "marcus aurelius lessons"]);
    // Three searches (101 each) plus one channel batch.
    expect(result).toMatchObject({ source: "youtube", unitsSpent: 304 });
    expect(niches.topicSample).toHaveBeenLastCalledWith("stoicism", expect.any(Date), undefined, ["stoic", "marcus aurelius"]);
    expect(niches.saveReport).toHaveBeenLastCalledWith(expect.objectContaining({ search_terms: ["stoic", "marcus aurelius"] }));
  });

  it("searches the topic as typed when the AI fails", async () => {
    const ai = { generateObject: vi.fn(async () => Promise.reject(new Error("rate limited"))) };
    const { service, youtube } = setup({ ai });
    const result = await service.research("stoicism", { userId: "u1", now: NOW });
    expect(youtube.searchVideos).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ source: "youtube", unitsSpent: 102 });
  });

  it("doesn't ask the AI when the topic already has some stored data", async () => {
    const ai = { generateObject: vi.fn() };
    const { service, youtube } = setup({ ai, sampleVideos: gamingSample().slice(0, 3) });
    await service.research("gaming", { userId: "u1", now: NOW });
    expect(ai.generateObject).not.toHaveBeenCalled();
    expect(youtube.searchVideos).toHaveBeenCalledTimes(1);
  });

  it("fetches from YouTube once for thin topics, stores results, then reuses the cache for everyone", async () => {
    const { service, youtube, channels, videos, credits, usage, enqueue } = setup();
    const first = await service.research("gaming", { userId: "u1", now: NOW });
    expect(first).toMatchObject({ source: "youtube", unitsSpent: 102 });
    expect(youtube.searchVideos).toHaveBeenCalledTimes(1);
    expect(youtube.getChannels).toHaveBeenCalledTimes(1);
    expect(channels.upsertMany).toHaveBeenCalledTimes(1);
    expect(videos.upsertMany).toHaveBeenCalledTimes(1);
    expect(credits.charge).toHaveBeenCalledWith("u1", "niche_research", "gaming", NOW);
    expect(usage.record).toHaveBeenCalledWith(expect.objectContaining({ event_type: NICHE_REFRESH_EVENT, resource_id: "gaming" }));
    expect(enqueue).toHaveBeenCalledWith("channel.refresh", expect.anything(), expect.objectContaining({ priority: -5 }));

    // Same topic, other users, different casing, an hour later: cached, no API calls, no charge.
    const later = new Date(NOW.getTime() + 3_600_000);
    const second = await service.research("  GAMING ", { userId: "u2", now: later });
    const third = await service.research("gaming", { userId: "u3", now: later });
    expect(second).toMatchObject({ source: "cache", unitsSpent: 0 });
    expect(third.source).toBe("cache");
    expect(youtube.searchVideos).toHaveBeenCalledTimes(1);
    expect(youtube.getChannels).toHaveBeenCalledTimes(1);
    expect(credits.charge).toHaveBeenCalledTimes(1);
  });

  it("deduplicates identical concurrent searches", async () => {
    const { service, youtube } = setup();
    const [a, b] = await Promise.all([service.research("fitness", { userId: "u1", now: NOW }), service.research("Fitness", { userId: "u2", now: NOW })]);
    expect(a).toBe(b);
    expect(youtube.searchVideos).toHaveBeenCalledTimes(1);
  });

  it("doesn't refresh a thin topic again within the refresh window, even after the cache expires", async () => {
    const { service, youtube, niches } = setup();
    await service.research("cooking", { userId: "u1", now: NOW });
    niches.topicSample.mockResolvedValue({ videos: [], channels: new Map() }); // still thin
    const afterTtl = new Date(NOW.getTime() + 7 * 3_600_000);
    const again = await service.research("cooking", { userId: "u2", now: afterTtl });
    expect(again).toMatchObject({ source: "database", unitsSpent: 0 });
    expect(youtube.searchVideos).toHaveBeenCalledTimes(1);
  });

  it("falls back to stored data and flags it when quota is unavailable", async () => {
    const { service, niches, credits } = setup({ searchError: new QuotaUnavailableError("user", new Date(), "daily") });
    const result = await service.research("beauty", { userId: "u1", now: NOW });
    expect(result).toMatchObject({ source: "database", stale: true, unitsSpent: 0 });
    expect(result.notice).toMatch(/may be older/);
    expect(niches.releaseClaim).toHaveBeenCalledWith("beauty");
    expect(credits.charge).not.toHaveBeenCalled();
  });

  it("skips YouTube when the daily refresh budget or the user's credits are used up", async () => {
    const budget = setup();
    budget.usage.countSince.mockResolvedValue(15);
    expect((await budget.service.research("tech", { userId: "u1", now: NOW })).notice).toMatch(/limit was reached/);
    expect(budget.youtube.searchVideos).not.toHaveBeenCalled();

    const broke = setup();
    broke.credits.status.mockResolvedValue({ used: 100, limit: 100, remaining: 0, resetsAt: "" });
    expect((await broke.service.research("tech", { userId: "u1", now: NOW })).notice).toMatch(/needs 5 credits/);
    expect(broke.youtube.searchVideos).not.toHaveBeenCalled();
  });

  it("rejects invalid topics", async () => {
    const { service } = setup();
    expect(() => service.research("x", { userId: null })).toThrow(/between 2 and 60/);
  });
});

describe("sub-niches and topic aliases", () => {
  it("doesn't offer a topic's own abbreviation as a niche inside it", async () => {
    const { topicAliases } = await import("@/lib/niches/analysis");
    expect(topicAliases("My Singing Monsters")).toEqual(expect.arrayContaining(["msm", "mysingingmonsters"]));
    expect(topicAliases("a topic nobody listed")).toEqual([]);

    const videos: NicheVideo[] = Array.from({ length: 12 }, (_, i) => ({
      id: `v${i}`,
      youtube_video_id: `vid${i}`.padEnd(11, "0"),
      channel_id: `c${i % 4}`,
      title: i % 2 ? `msm wubbox breeding guide ${i}` : `msm rare island tour ${i}`,
      tags: [],
      format: "short",
      view_count: 10_000 + i,
      like_count: 100,
      comment_count: 10,
      published_at: new Date(Date.UTC(2026, 8, 1 + i)).toISOString(),
      outlier_score: null,
    }));
    const terms = discoverSubNiches(videos, "my singing monsters").map((s) => s.term);
    expect(terms).not.toContain("msm");
    expect(terms.join(" ")).toMatch(/wubbox|island|breeding/);
  });
});
