import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/lib/core/logger";
import type { MonitoredVideo } from "@/lib/database/repositories/videos";
import { MonitoringService } from "@/lib/services/monitoring-service";
import { QuotaUnavailableError } from "@/lib/youtube/quota-manager";
import type { YouTubeService } from "@/lib/youtube/service";
import { makeVideo } from "../helpers/fixtures";

const NOW = new Date("2026-09-16T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const monitored = (id: string, overrides: Partial<MonitoredVideo> = {}): MonitoredVideo => ({
  id: `uuid-${id}`,
  youtube_video_id: id,
  channel_id: "chan-1",
  view_count: 10_000,
  published_at: hoursAgo(20),
  views_per_hour: null,
  last_checked_at: hoursAgo(1),
  last_synced_at: hoursAgo(1),
  monitor_priority: 2,
  ...overrides,
});

function setup(due: MonitoredVideo[], getVideos: YouTubeService["getVideos"]) {
  const deps = {
    youtube: { getVideos },
    videos: {
      listDueForMonitoring: vi.fn(async () => due),
      applyMonitoring: vi.fn(async (u: unknown[]) => u.length),
      insertSnapshots: vi.fn(async () => []),
    },
    channels: {
      raiseMonitorPriority: vi.fn(async () => {}),
      listDueForMonitoring: vi.fn(async () => []),
      scheduleMonitoring: vi.fn(async () => {}),
      medianShortViews: vi.fn(async () => new Map<string, number>()),
    },
    channelService: { snapshotChannelStats: vi.fn(async () => ({ updated: 0, snapshots: 0 })) },
    enqueue: vi.fn(async () => ({})),
  };
  return { deps, service: new MonitoringService(deps as never, createLogger()) };
}

describe("MonitoringService.monitorVideos", () => {
  it("batches checks, records momentum, retires missing videos, and raises hot channels", async () => {
    const due = [monitored("hotvideo001"), monitored("slowvideo01", { channel_id: "chan-2", published_at: hoursAgo(24 * 10) }), monitored("deletedvid1")];
    const getVideos = vi.fn(async () => [
      makeVideo({ id: "hotvideo001", views: 20_000 }), // +10k in 1h
      makeVideo({ id: "slowvideo01", views: 10_050 }),
    ]);
    const { deps, service } = setup(due, getVideos as never);

    const result = await service.monitorVideos({ maxVideos: 100 }, NOW);

    expect(getVideos).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ checked: 2, missing: 1, hot: 1, quotaUnits: 1, stoppedBy: "done" });
    const updates = deps.videos.applyMonitoring.mock.calls[0]![0] as { id: string; views_per_hour: number | null; monitor_priority: number; next_check_at: string | null }[];
    expect(updates.find((u) => u.id === "uuid-hotvideo001")).toMatchObject({ views_per_hour: 10_000, monitor_priority: 3, next_check_at: "2026-09-16T13:00:00.000Z" });
    expect(updates.find((u) => u.id === "uuid-deletedvid1")).toMatchObject({ monitor_priority: 0, next_check_at: null });
    expect(deps.channels.raiseMonitorPriority).toHaveBeenCalledWith(["chan-1"], 3, NOW);
  });

  it("stops cleanly when quota runs out, keeping earlier batches", async () => {
    const due = Array.from({ length: 60 }, (_, i) => monitored(`video${String(i).padStart(6, "0")}`));
    const getVideos = vi
      .fn()
      .mockResolvedValueOnce(due.slice(0, 50).map((v) => makeVideo({ id: v.youtube_video_id, views: 10_100 })))
      .mockRejectedValueOnce(new QuotaUnavailableError("background", new Date(), "lane"));
    const { deps, service } = setup(due, getVideos as never);

    const result = await service.monitorVideos({ maxVideos: 100 }, NOW);
    expect(result).toMatchObject({ checked: 50, stoppedBy: "quota", quotaUnits: 1 });
    expect(deps.videos.applyMonitoring).toHaveBeenCalledTimes(1);
  });
});

describe("MonitoringService.monitorChannels", () => {
  it("snapshots due channels, decays priority, and re-syncs hot stale channels", async () => {
    const { deps, service } = setup([], vi.fn() as never);
    deps.channels.listDueForMonitoring.mockResolvedValue([
      { id: "c-hot", youtube_channel_id: "UChot", monitor_priority: 3, last_synced_at: hoursAgo(48) },
      { id: "c-warm", youtube_channel_id: "UCwarm", monitor_priority: 2, last_synced_at: hoursAgo(1) },
    ] as never);

    const result = await service.monitorChannels({ maxChannels: 100 }, NOW);
    expect(result).toMatchObject({ checked: 2, quotaUnits: 1, resynced: 1 });
    expect(deps.channelService.snapshotChannelStats).toHaveBeenCalledWith(["UChot", "UCwarm"], NOW);
    expect(deps.channels.scheduleMonitoring).toHaveBeenCalledWith(["c-hot"], 2, new Date("2026-09-16T13:00:00Z"));
    expect(deps.channels.scheduleMonitoring).toHaveBeenCalledWith(["c-warm"], 1, new Date("2026-09-16T18:00:00Z"));
    expect(deps.enqueue).toHaveBeenCalledWith("channel.refresh", { channelId: "UChot", light: true }, expect.objectContaining({ priority: 5 }));
  });
});
