import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/lib/core/logger";
import type { ChannelRepository } from "@/lib/database/repositories/channels";
import { escapeLike } from "@/lib/database/repositories/channels";
import type { UsageRepository } from "@/lib/database/repositories/usage";
import { ResearchService } from "@/lib/services/research-service";
import type { YouTubeService } from "@/lib/youtube/service";
import { makeChannel, makeVideo } from "../helpers/fixtures";

const NOW = new Date("2026-09-13T15:00:00Z");
const A = "UCaaaaaaaaaaaaaaaaaaaaaa";
const B = "UCbbbbbbbbbbbbbbbbbbbbbb";
const C = "UCcccccccccccccccccccccc";
const D = "UCdddddddddddddddddddddd";

function setup(overrides: { usedToday?: number; fresh?: string[]; known?: string[]; many?: boolean; maxChannels?: number } = {}) {
  const videos = overrides.many
    ? Array.from({ length: 9 }, (_, i) => makeVideo({ id: `e000000000${i}`, channelId: `UC${String(i).repeat(22)}`, views: 300_000 }))
    : [
    makeVideo({ id: "a0000000001", channelId: A, views: 300_000 }),
    makeVideo({ id: "b0000000001", channelId: B, views: 900_000 }),
    makeVideo({ id: "c0000000001", channelId: C, views: 60_000 }),
    // Non-English channel: filtered out.
    makeVideo({ id: "d0000000001", channelId: D, views: 5_000_000, defaultAudioLanguage: "pt" }),
      ];
  const searchVideos = vi.fn(async () => ({ items: videos, nextPageToken: "page2", prevPageToken: null, totalResults: videos.length }));
  const getChannels = vi.fn(async (ids: readonly string[]) =>
    ids.map((id) => makeChannel({ id, subscribers: { [A]: 20_000, [B]: 10_000, [C]: 40_000, [D]: 1_000 }[id] ?? 10_000 })),
  );
  const enqueue = vi.fn(async () => ({}));
  const record = vi.fn(async () => ({}));
  const countSince = vi.fn(async () => overrides.usedToday ?? 0);
  const assertCapacity = vi.fn(async () => ({}));
  const service = new ResearchService(
    {
      youtube: { searchVideos, getChannels } as unknown as YouTubeService,
      channels: {
        recentlySyncedIds: async () => new Set(overrides.fresh ?? []),
        existingIds: async () => new Set(overrides.known ?? []),
      } as unknown as ChannelRepository,
      usage: { record, countSince } as unknown as UsageRepository,
      storage: { assertCapacity } as never,
      enqueue,
    },
    { discoveryDailyLimit: 10, discoveryMaxChannels: overrides.maxChannels ?? 25, regionCode: "US" },
    createLogger(),
  );
  return { service, search: searchVideos, enqueue, record, countSince, assertCapacity };
}

describe("ResearchService.discoverShortsChannels", () => {
  it("searches English/US Shorts and queues quality channels ranked by underrated score", async () => {
    const { service, search, enqueue, record } = setup();
    const result = await service.discoverShortsChannels("  cooking hacks ", "user-1", NOW);

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ q: "cooking hacks", videoDuration: "short", order: "viewCount", relevanceLanguage: "en", regionCode: "US" }),
    );
    expect(enqueue.mock.calls.map((c) => (c as unknown[])[1])).toEqual([
      { channelId: B, light: true },
      { channelId: A, light: true },
      { channelId: C, light: true },
    ]);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ event_type: "research.shorts_discovery", user_id: "user-1" }));
    expect(result).toEqual({
      keyword: "cooking hacks",
      channelsFound: 3,
      channelsNew: 3,
      channelsQueued: 3,
      alreadyFresh: 0,
      searchesLeftToday: 9,
      searchPasses: 2,
    });
  });

  it("stops after one search once it has enough channels nobody had yet", async () => {
    const { service, search } = setup({ many: true });
    const result = await service.discoverShortsChannels("cooking", null, NOW);
    expect(search).toHaveBeenCalledTimes(1);
    expect(result.channelsNew).toBeGreaterThanOrEqual(7);
  });

  it("digs deeper when the first search only returns channels we already have", async () => {
    const { service, search, record } = setup({ known: [A, B, C] });
    const result = await service.discoverShortsChannels("cooking", null, NOW);
    // It pages past the first set of results, then gives up because nothing new turned up.
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls.map((call) => (call as unknown as [{ pageToken?: string }])[0].pageToken)).toEqual([undefined, "page2"]);
    expect(result.channelsNew).toBe(0);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ new: 0, passes: 2 }) }));
  });

  it("skips recently synced channels and respects the per-search cap", async () => {
    const { service, enqueue } = setup({ fresh: [B], known: [A, B, C], maxChannels: 1 });
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

describe("ResearchService.browseShortsChannels", () => {
  const rows = [
    { channel_id: "old-1", youtube_channel_id: A },
    { channel_id: "new-1", youtube_channel_id: B },
    { channel_id: "new-2", youtube_channel_id: C },
  ];

  function browseSetup(discoveries: { occurredAt: string; channelIds: string[] }[]) {
    const searchShortsChannels = vi.fn(async () => rows as never);
    const findChannelIdsByKeywords = vi.fn(async () => ["old-1"]);
    const service = new ResearchService(
      {
        youtube: {} as unknown as YouTubeService,
        channels: {
          searchShortsChannels,
          findChannelIdsByKeywords,
          findByIdentifiers: async (ids: string[]) => rows.filter((r) => ids.includes(r.youtube_channel_id)).map((r) => ({ id: r.channel_id, youtube_channel_id: r.youtube_channel_id })),
        } as unknown as ChannelRepository,
        usage: { discoveriesFor: async () => discoveries } as unknown as UsageRepository,
        storage: { assertCapacity: async () => ({}) } as never,
        enqueue: vi.fn(),
      },
      { discoveryDailyLimit: 10, discoveryMaxChannels: 25 },
      createLogger(),
    );
    return { service, searchShortsChannels };
  }

  it("includes channels the search just discovered, newest first", async () => {
    const { service, searchShortsChannels } = browseSetup([
      { occurredAt: NOW.toISOString(), channelIds: [C, B] },
      { occurredAt: "2026-09-01T00:00:00Z", channelIds: [B] },
    ]);
    const { channels } = await service.browseShortsChannels("cooking", { orderBy: "avg_short_views", limit: 10 }, 0, NOW);

    // Keyword matches plus everything discovered for this keyword.
    expect((searchShortsChannels.mock.calls[0] as unknown as [{ channelIds: string[] }])[0].channelIds).toEqual(["old-1", "new-1", "new-2"]);
    // The latest discovery leads, in the order it ranked them.
    expect(channels.map((c) => c.channel_id)).toEqual(["new-2", "new-1", "old-1"]);
  });

  it("leaves the order alone when nothing was discovered for the search", async () => {
    const { service } = browseSetup([]);
    const { channels } = await service.browseShortsChannels("cooking", { orderBy: "avg_short_views", limit: 10 }, 0, NOW);
    expect(channels.map((c) => c.channel_id)).toEqual(["old-1", "new-1", "new-2"]);
  });
});
