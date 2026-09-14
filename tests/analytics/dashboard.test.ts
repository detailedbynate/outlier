import { describe, expect, it, vi } from "vitest";
import { activityItem, channelAlerts, channelGrowth, greetingName } from "@/lib/analytics/dashboard";
import { createLogger } from "@/lib/core/logger";
import { DashboardService } from "@/lib/services/dashboard-service";

const NOW = new Date("2026-09-20T12:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe("channelGrowth", () => {
  it("computes 24h and 7d subscriber and view changes from snapshots", () => {
    const growth = channelGrowth([
      { captured_at: ago(24 * 7), subscriber_count: 1_000, view_count: 50_000 },
      { captured_at: ago(24), subscriber_count: 1_080, view_count: 58_000 },
      { captured_at: ago(0), subscriber_count: 1_100, view_count: 62_000 },
    ]);
    expect(growth).toEqual({ subs24h: 20, subs7d: 100, views24h: 4_000, views7d: 12_000 });
    expect(channelGrowth([])).toEqual({ subs24h: null, subs7d: null, views24h: null, views7d: null });
  });
});

describe("channelAlerts", () => {
  it("flags breakouts, strong days, subscriber dips, and upload gaps", () => {
    const alerts = channelAlerts(
      {
        growth: { subs24h: -5, subs7d: -40, views24h: 9_000, views7d: 14_000 },
        videos: [{ youtube_video_id: "abcdefghijk", title: "Big one", published_at: ago(30), outlier_score: 3.4, view_count: 90_000 }],
        lastUploadAt: ago(24 * 20),
      },
      NOW,
    );
    expect(alerts.map((a) => [a.tone, a.title])).toEqual([
      ["good", "3.4× your usual views"],
      ["good", "Unusually strong day"],
      ["warn", "Subscribers dipped this week"],
      ["info", "No uploads in a while"],
    ]);
    expect(channelAlerts({ growth: { subs24h: 1, subs7d: 5, views24h: 100, views7d: 1_400 }, videos: [], lastUploadAt: ago(2) }, NOW)).toEqual([]);
  });
});

describe("activity and greeting", () => {
  it("labels research events and ignores others", () => {
    expect(activityItem({ id: "1", event_type: "research.shorts_discovery", resource_id: "cooking", occurred_at: ago(1) })).toMatchObject({
      kind: "search",
      label: "Searched “cooking”",
      href: "/research/shorts-channels?q=cooking",
    });
    expect(activityItem({ id: "2", event_type: "dashboard.visit", resource_id: null, occurred_at: ago(1) })).toBeNull();
  });

  it("uses the profile name, else a tidy email name", () => {
    expect(greetingName("x@example.com", "Nate Smith")).toBe("Nate");
    expect(greetingName("jane.doe99@example.com")).toBe("Jane");
    expect(greetingName("123@example.com")).toBe("there");
  });
});

describe("DashboardService.registerVisit", () => {
  function setup(visits: string[]) {
    const usage = {
      recentForUser: vi.fn(async () => visits.map((at, i) => ({ id: String(i), occurred_at: at }))),
      countForUserSince: vi.fn(),
      record: vi.fn(async () => ({})),
    };
    const service = new DashboardService({ usage } as never, createLogger());
    return { service, usage };
  }

  it("returns the last visit from an earlier session and records a new one", async () => {
    const { service, usage } = setup([ago(5)]);
    expect(await service.registerVisit("u1", NOW)).toBe(ago(5));
    expect(usage.record).toHaveBeenCalledTimes(1);
  });

  it("ignores reloads within the current session", async () => {
    const { service, usage } = setup([ago(0.1), ago(0.2), ago(26)]);
    expect(await service.registerVisit("u1", NOW)).toBe(ago(26));
    expect(usage.record).not.toHaveBeenCalled();
  });
});