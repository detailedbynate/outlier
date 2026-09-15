import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/lib/core/logger";
import {
  channelProfile,
  compareToCompetitors,
  competitorAlerts,
  competitorBreakouts,
  findOpportunities,
  growthOf,
  sortProfiles,
  weeklyUploads,
  whatsWorking,
  type IntelChannel,
  type IntelSnapshot,
  type IntelVideo,
} from "@/lib/competitors/intel";
import { CompetitorService } from "@/lib/services/competitor-service";
import type { ChannelRow } from "@/types/database";

const NOW = new Date("2026-09-20T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function channel(id: string, overrides: Partial<IntelChannel> = {}): IntelChannel {
  return {
    id,
    youtube_channel_id: `UC${id.padEnd(22, "x")}`,
    title: `Channel ${id}`,
    handle: `@${id}`,
    thumbnail_url: null,
    subscriber_count: 10_000,
    hidden_subscriber_count: false,
    view_count: 1_000_000,
    video_count: 100,
    last_synced_at: hoursAgo(2),
    ...overrides,
  };
}

let seq = 0;
function video(channelId: string, overrides: Partial<IntelVideo> = {}): IntelVideo {
  seq += 1;
  return {
    id: `vid-${seq}`,
    youtube_video_id: `yt${String(seq).padStart(9, "0")}`,
    channel_id: channelId,
    title: "Regular upload",
    tags: [],
    format: "short",
    duration_seconds: 45,
    thumbnail_url: null,
    view_count: 10_000,
    like_count: 400,
    comment_count: 100,
    published_at: hoursAgo(48),
    views_per_hour: null,
    view_acceleration: null,
    outlier_score: null,
    engagement_rate: null,
    ...overrides,
  };
}

/** Daily snapshots over `days`, with views gaining `dailyViews(dayIndex)` per day. */
function snapshots(channelId: string, days: number, dailyViews: (d: number) => number, subsPerDay = 100): IntelSnapshot[] {
  const rows: IntelSnapshot[] = [];
  let views = 1_000_000;
  let subs = 10_000;
  for (let d = days; d >= 0; d--) {
    rows.push({ channel_id: channelId, captured_at: hoursAgo(d * 24), subscriber_count: subs, view_count: views });
    views += dailyViews(d);
    subs += subsPerDay;
  }
  return rows;
}

describe("growth and trend", () => {
  it("computes 24h/48h/7d windows and only shows 30d with a month of history", () => {
    const g = growthOf(snapshots("a", 10, () => 1_000), NOW);
    expect(g.h24).toMatchObject({ subs: 100, views: 1_000 });
    expect(g.h48.subs).toBe(200);
    expect(g.d7.subs).toBe(700);
    expect(g.d30).toBeNull();
    // 30d allows a day of slack for snapshot timing, so it measures from the snapshot ~29 days back.
    expect(growthOf(snapshots("a", 31, () => 1_000), NOW).d30?.subs).toBe(2_900);
  });

  it("labels accelerating, slowing, rising, and insufficient from view velocity", () => {
    expect(growthOf(snapshots("a", 8, (d) => (d <= 3 ? 5_000 : 1_000), 0), NOW).trend.label).toBe("accelerating");
    expect(growthOf(snapshots("a", 8, (d) => (d <= 3 ? 200 : 1_000), 0), NOW).trend.label).toBe("slowing");
    expect(growthOf(snapshots("a", 8, () => 1_000, 50), NOW).trend.label).toBe("rising"); // steady views, +3.5% subs/week
    expect(growthOf(snapshots("a", 8, () => 1_000, 1), NOW).trend.label).toBe("stable");
    expect(growthOf(snapshots("a", 2, () => 1_000), NOW).trend.label).toBe("insufficient");
  });
});

describe("channel profiles", () => {
  it("summarizes averages, frequency, engagement, outlier rate, and the best recent video", () => {
    const vids = [
      video("a", { view_count: 90_000, title: "Huge hit", published_at: hoursAgo(30) }),
      video("a", { view_count: 10_000, published_at: hoursAgo(80) }),
      video("a", { view_count: 12_000, published_at: hoursAgo(200) }),
      video("a", { view_count: 8_000, format: "long_form", duration_seconds: 600, published_at: hoursAgo(400) }),
      video("other", { view_count: 1 }),
    ];
    const p = channelProfile(channel("a"), vids, snapshots("a", 8, () => 1_000), NOW);
    expect(p).toMatchObject({ sampleSize: 4, avgShortViews: 37_333, avgLongViews: 8_000, uploadsPerWeek: 1, shortsShare: 0.75 });
    expect(p.medianViews).toBe(11_000);
    expect(p.outlierRate).toBe(0.25);
    expect(p.bestRecent?.title).toBe("Huge hit");
    expect(p.engagement).toBeCloseTo(vids.slice(0, 4).reduce((s, v) => s + 500 / v.view_count, 0) / 4, 5);
    expect(p.recentViews).toBe(7_000);
  });

  it("sorts by momentum for fastest growth, not just size", () => {
    const big = channelProfile(channel("big", { subscriber_count: 5_000_000 }), [], snapshots("big", 8, () => 1_000, 1), NOW);
    const hot = channelProfile(channel("hot", { subscriber_count: 20_000 }), [], snapshots("hot", 8, (d) => (d <= 3 ? 9_000 : 1_000), 10), NOW);
    expect(sortProfiles([big, hot], "growth").map((p) => p.channel.id)).toEqual(["hot", "big"]);
    expect(sortProfiles([big, hot], "subscribers").map((p) => p.channel.id)).toEqual(["big", "hot"]);
  });
});

describe("you vs competitors", () => {
  it("reports percentage differences and only draws conclusions with enough data", () => {
    const you = channelProfile(channel("you"), [1, 2, 3].map(() => video("you", { view_count: 13_200 })), [], NOW);
    const them = channelProfile(channel("c1"), [1, 2, 3].map(() => video("c1", { view_count: 10_000 })), [], NOW);
    const { rows, insights } = compareToCompetitors(you, [them]);
    expect(rows.find((r) => r.key === "shorts")).toMatchObject({ you: 13_200, competitorAvg: 10_000, diff: 0.32 });
    expect(insights.some((s) => s.includes("32% more average views per Short"))).toBe(true);
    // Competitors with too few uploads don't skew the average.
    const sparse = channelProfile(channel("c2"), [video("c2", { view_count: 900_000 })], [], NOW);
    expect(compareToCompetitors(you, [them, sparse]).rows.find((r) => r.key === "shorts")?.competitorAvg).toBe(10_000);

    const thin = channelProfile(channel("thin"), [video("thin", { view_count: 50_000 })], [], NOW);
    expect(compareToCompetitors(thin, [them]).insights.some((s) => s.includes("views per Short"))).toBe(false);
  });
});

describe("breakouts, patterns, opportunities, alerts", () => {
  function competitorSet() {
    const a = [
      ...[1, 2, 3, 4].map((i) => video("a", { view_count: 10_000, title: `Daily routine ${i}`, published_at: hoursAgo(24 * 20 + i) })),
      video("a", { view_count: 80_000, title: "Minecraft speedrun world record?", published_at: hoursAgo(20), view_acceleration: 50 }),
      video("a", { view_count: 60_000, title: "Minecraft speedrun glitch", published_at: hoursAgo(100) }),
    ];
    const b = [
      ...[1, 2, 3].map((i) => video("b", { view_count: 5_000, title: `Vlog ${i}`, published_at: hoursAgo(24 * 15 + i) })),
      video("b", { view_count: 40_000, title: "Minecraft speedrun tips", published_at: hoursAgo(50) }),
    ];
    const profiles = [channelProfile(channel("a"), a, [], NOW), channelProfile(channel("b"), b, [], NOW)];
    return profiles;
  }

  it("finds recent breakouts, strongest and newest first", () => {
    const breakouts = competitorBreakouts(competitorSet(), NOW);
    expect(breakouts.length).toBeGreaterThan(0);
    expect(breakouts[0]!.title).toBe("Minecraft speedrun world record?");
    expect(breakouts.every((v) => (v.multiplier ?? 0) >= 2 || v.vph > 0)).toBe(true);
  });

  it("identifies topics and formats that outperform, from real uploads", () => {
    const working = whatsWorking(competitorSet(), NOW);
    const topic = working.topics.find((t) => t.label.includes("minecraft") || t.label.includes("speedrun"));
    expect(topic).toBeDefined();
    expect(topic!.channels).toBe(2);
    expect(topic!.lift!).toBeGreaterThan(1);
    expect(working.formats.map((f) => f.label)).toContain("Shorts");
  });

  it("only suggests measured opportunities, referencing real numbers", () => {
    const profiles = competitorSet();
    const you = channelProfile(channel("you"), [1, 2, 3, 4, 5].map((i) => video("you", { title: `Cooking ${i}`, format: "long_form", duration_seconds: 600, published_at: hoursAgo(24 * i) })), [], NOW);
    const opps = findOpportunities(you, profiles, NOW);
    const gap = opps.find((o) => o.kind === "topic_gap");
    expect(gap?.detail).toMatch(/2 competitors posted 3 videos about “(minecraft|speedrun|minecraft speedrun)” in the last 30 days, averaging 60K views/);
    expect(opps.some((o) => o.title === "Shorts opportunity")).toBe(true);
    expect(findOpportunities(null, [], NOW)).toEqual([]);
  });

  it("builds alerts only for enabled kinds", () => {
    const profiles = competitorSet();
    const all = competitorAlerts(profiles, new Set(["uploads", "breakouts"]), NOW);
    expect(all.some((a) => a.kind === "breakouts")).toBe(true);
    expect(competitorAlerts(profiles, new Set(["subscriber_growth"]), NOW)).toEqual([]);
  });

  it("buckets weekly uploads by format", () => {
    const weeks = weeklyUploads([video("a", { published_at: hoursAgo(24) }), video("a", { format: "long_form", published_at: hoursAgo(30) }), video("a", { published_at: hoursAgo(24 * 10) })], 2, NOW);
    expect(weeks.map((w) => [w.shorts, w.longForm])).toEqual([[1, 0], [1, 1]]);
  });
});

describe("CompetitorService data efficiency", () => {
  const row = (id: string, handle: string, syncedHoursAgo: number) =>
    ({ id, youtube_channel_id: `UC${id.padEnd(22, "x")}`, handle, title: id, thumbnail_url: null, subscriber_count: 1, hidden_subscriber_count: false, view_count: 1, video_count: 1, last_synced_at: hoursAgo(syncedHoursAgo) }) as unknown as ChannelRow;

  function setup(rows: ChannelRow[]) {
    const deps = {
      channels: {
        findByIdentifiers: vi.fn(async () => rows),
        snapshotsForChannels: vi.fn(async () => []),
        findByYouTubeId: vi.fn(async () => null),
        raiseMonitorPriority: vi.fn(async () => {}),
      },
      competitors: {
        videosForChannels: vi.fn(async () => []),
        topVideos: vi.fn(async () => []),
        alertSettings: vi.fn(async () => ["uploads"]),
        saveAlertSettings: vi.fn(async () => {}),
      },
      compare: { compare: vi.fn(async () => ({ you: null, competitors: [], failures: [] })) },
    };
    return { deps, service: new CompetitorService(deps as never, createLogger()) };
  }

  it("builds the workspace from stored data without any YouTube calls", async () => {
    const { deps, service } = setup([row("fresh", "@fresh", 1), row("mine", "@mine", 1)]);
    const ws = await service.workspace({ you: "@mine", competitors: ["@fresh", "@unknown"], userId: "u1", now: NOW });
    expect(deps.compare.compare).not.toHaveBeenCalled();
    expect(ws.you?.channel.id).toBe("mine");
    expect(ws.competitors.map((c) => c.channel.id)).toEqual(["fresh"]);
    expect(ws.missing).toEqual(["@unknown"]);
    expect(ws.enabledAlerts).toEqual(["uploads"]);
  });

  it("syncs only missing or stale channels and gives competitors warm monitoring", async () => {
    const { deps, service } = setup([row("fresh", "@fresh", 1), row("stale", "@stale", 30)]);
    const result = await service.sync({ you: null, competitors: ["@fresh", "@stale", "@new"], now: NOW });
    expect(deps.compare.compare).toHaveBeenCalledWith(null, ["@stale", "@new"], NOW);
    expect(result.skipped).toBe(1);
    expect(deps.channels.raiseMonitorPriority).toHaveBeenCalledWith(["fresh", "stale"], 2, NOW);
  });

  it("makes no YouTube calls when everything is fresh", async () => {
    const { deps, service } = setup([row("fresh", "@fresh", 1)]);
    await service.sync({ you: null, competitors: ["@fresh"], now: NOW });
    expect(deps.compare.compare).not.toHaveBeenCalled();
  });
});
