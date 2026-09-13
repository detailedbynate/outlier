import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/lib/core/logger";
import type { ChannelRepository } from "@/lib/database/repositories/channels";
import { escapeLike } from "@/lib/database/repositories/channels";
import type { UsageRepository } from "@/lib/database/repositories/usage";
import { ResearchService } from "@/lib/services/research-service";
import type { YouTubeService } from "@/lib/youtube/service";

const NOW = new Date("2026-09-13T15:00:00Z");
const A = "UCaaaaaaaaaaaaaaaaaaaaaa";
const B = "UCbbbbbbbbbbbbbbbbbbbbbb";
const C = "UCcccccccccccccccccccccc";

function setup(overrides: { usedToday?: number; fresh?: string[]; maxChannels?: number } = {}) {
  const search = vi.fn(async () => ({
    items: [A, B, B, C, B, A].map((channelId, i) => ({ kind: "video", id: `vid${i}`, channelId })),
    nextPageToken: null,
    prevPageToken: null,
    totalResults: 6,
  }));
  const enqueue = vi.fn(async () => ({}));
  const record = vi.fn(async () => ({}));
  const countSince = vi.fn(async () => overrides.usedToday ?? 0);
  const assertCapacity = vi.fn(async () => ({}));
  const service = new ResearchService(
    {
      youtube: { search } as unknown as YouTubeService,
      channels: { recentlySyncedIds: async () => new Set(overrides.fresh ?? []) } as unknown as ChannelRepository,
      usage: { record, countSince } as unknown as UsageRepository,
      storage: { assertCapacity } as never,
      enqueue,
    },
    { discoveryDailyLimit: 10, discoveryMaxChannels: overrides.maxChannels ?? 25 },
    createLogger(),
  );
  return { service, search, enqueue, record, countSince, assertCapacity };
}

describe("ResearchService.discoverShortsChannels", () => {
  it("searches recent popular Shorts and queues channels ranked by hits", async () => {
    const { service, search, enqueue, record } = setup();
    const result = await service.discoverShortsChannels("  cooking hacks ", "user-1", NOW);

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ q: "cooking hacks", type: "video", videoDuration: "short", order: "viewCount", maxResults: 50 }),
    );
    expect(enqueue.mock.calls.map((c) => (c as unknown[])[1])).toEqual([
      { channelId: B, light: true },
      { channelId: A, light: true },
      { channelId: C, light: true },
    ]);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ event_type: "research.shorts_discovery", user_id: "user-1" }));
    expect(result).toEqual({ keyword: "cooking hacks", channelsFound: 3, channelsQueued: 3, alreadyFresh: 0, searchesLeftToday: 9 });
  });

  it("skips recently synced channels and respects the per-search cap", async () => {
    const { service, enqueue } = setup({ fresh: [B], maxChannels: 1 });
    const result = await service.discoverShortsChannels("minecraft", null, NOW);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect((enqueue.mock.calls[0] as unknown[])[1]).toEqual({ channelId: A, light: true });
    expect(result.alreadyFresh).toBe(1);
  });

  it("enforces the daily limit before spending quota", async () => {
    const { service, search } = setup({ usedToday: 10 });
    await expect(service.discoverShortsChannels("minecraft", null, NOW)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(search).not.toHaveBeenCalled();
  });

  it("rejects bad keywords and full storage before searching", async () => {
    const { service, search, assertCapacity } = setup();
    await expect(service.discoverShortsChannels("a", null, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    assertCapacity.mockRejectedValueOnce(Object.assign(new Error("full"), { code: "STORAGE_BUDGET_EXCEEDED" }));
    await expect(service.discoverShortsChannels("minecraft", null, NOW)).rejects.toThrow("full");
    expect(search).not.toHaveBeenCalled();
  });
});

describe("escapeLike", () => {
  it("escapes wildcards and filter separators", () => {
    expect(escapeLike('100%_real,(ok)*"')).toBe("100\\%\\_real  ok   ");
  });
});
