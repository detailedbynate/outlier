import { describe, expect, it, vi } from "vitest";
import { HybridYouTubeSource } from "@/lib/innertube/hybrid";
import { InnerTubeBlockedError, InnerTubeGate } from "@/lib/innertube/gate";
import { parseCountText, type InnerTubeSource } from "@/lib/innertube/source";
import { NotFoundError } from "@/lib/core/errors";
import type { YouTubeService } from "@/lib/youtube/service";
import type { YouTubeChannel, YouTubeVideo } from "@/types/youtube";

const CHANNEL_ID = "UC_x5XG1OV2P6uZZ5FSM9Ttw";

const channel = (id: string, title: string): YouTubeChannel =>
  ({ id, title, statistics: { subscriberCount: 1, viewCount: 2, videoCount: 3, hiddenSubscriberCount: false } }) as YouTubeChannel;

const video = (id: string, publishedAt: string): YouTubeVideo => ({ id, publishedAt }) as YouTubeVideo;

function build(overrides: {
  innertube?: Partial<InnerTubeSource>;
  api?: Partial<YouTubeService>;
  apiFallback?: boolean;
} = {}) {
  const innertube = {
    getChannel: vi.fn(async () => channel(CHANNEL_ID, "scraped")),
    getUploads: vi.fn(async () => ({ ids: ["aaaaaaaaaaa", "bbbbbbbbbbb"], shortIds: new Set(["bbbbbbbbbbb"]), longFormIds: new Set(["aaaaaaaaaaa"]) })),
    ...overrides.innertube,
  } as unknown as InnerTubeSource;
  const api = {
    getChannel: vi.fn(async () => channel(CHANNEL_ID, "official")),
    getChannels: vi.fn(async () => []),
    getChannelVideos: vi.fn(async () => ({ items: [video("ccccccccccc", "2026-01-01T00:00:00Z")], nextPageToken: null, prevPageToken: null, totalResults: 1 })),
    getVideos: vi.fn(async () => [video("aaaaaaaaaaa", "2026-01-01T00:00:00Z"), video("bbbbbbbbbbb", "2026-02-01T00:00:00Z")]),
    ...overrides.api,
  } as unknown as YouTubeService;
  const gate = new InnerTubeGate();
  return { source: new HybridYouTubeSource(innertube, api, gate, { apiFallback: overrides.apiFallback ?? true }), innertube, api, gate };
}

describe("parseCountText", () => {
  it.each([
    ["1,003 videos", 1003],
    ["140,334,066,914 views", 140_334_066_914],
    ["517M subscribers", 517_000_000],
    ["1.2K subscribers", 1200],
    ["No videos", null],
    [undefined, null],
  ])("parses %s", (input, expected) => {
    expect(parseCountText(input)).toBe(expected);
  });
});

describe("HybridYouTubeSource", () => {
  it("reads channels from InnerTube and never touches the API", async () => {
    const { source, api } = build();
    await expect(source.getChannel(CHANNEL_ID)).resolves.toMatchObject({ title: "scraped" });
    expect(api.getChannel).not.toHaveBeenCalled();
    expect(source.takeCounts()).toMatchObject({ innertube: 1, api: 0 });
  });

  it("falls back to the API when a scrape fails", async () => {
    const { source, api } = build({ innertube: { getChannel: vi.fn(async () => { throw new Error("parse error"); }) } });
    await expect(source.getChannel(CHANNEL_ID)).resolves.toMatchObject({ title: "official" });
    expect(api.getChannel).toHaveBeenCalledWith(CHANNEL_ID);
    expect(source.takeCounts()).toMatchObject({ innertube: 0, api: 1 });
  });

  it("lets the API carry reads while InnerTube is paused", async () => {
    const { source, api } = build({ innertube: { getChannel: vi.fn(async () => { throw new InnerTubeBlockedError("captcha"); }) } });
    await expect(source.getChannel(CHANNEL_ID)).resolves.toMatchObject({ title: "official" });
    expect(api.getChannel).toHaveBeenCalledOnce();
  });

  it("gives up when the API fallback is switched off", async () => {
    const { source, api } = build({
      apiFallback: false,
      innertube: { getChannel: vi.fn(async () => { throw new InnerTubeBlockedError("captcha"); }) },
    });
    await expect(source.getChannel(CHANNEL_ID)).rejects.toThrow(InnerTubeBlockedError);
    expect(api.getChannel).not.toHaveBeenCalled();
  });

  it("rethrows a missing channel without asking the API", async () => {
    const { source, api } = build({ innertube: { getChannel: vi.fn(async () => { throw new NotFoundError("YouTube channel", CHANNEL_ID); }) } });
    await expect(source.getChannel(CHANNEL_ID)).rejects.toThrow(NotFoundError);
    expect(api.getChannel).not.toHaveBeenCalled();
  });

  it("reports the pause while the gate's breaker is open", async () => {
    const { source, gate } = build();
    expect(source.paused).toBe(false);
    gate.trip("captcha");
    expect(source.paused).toBe(true);
  });

  it("resolves handles through the API, which knows how to look them up", async () => {
    const { source, api, innertube } = build();
    await source.getChannel("@mkbhd");
    expect(api.getChannel).toHaveBeenCalledWith("@mkbhd");
    expect(innertube.getChannel).not.toHaveBeenCalled();
  });

  it("gets exact video stats from the API, with formats from the scraped tabs, newest first", async () => {
    const { source, api } = build();
    const page = await source.getChannelVideos(CHANNEL_ID);
    expect(api.getVideos).toHaveBeenCalledWith(["aaaaaaaaaaa", "bbbbbbbbbbb"], {
      knownShortIds: new Set(["bbbbbbbbbbb"]),
      knownLongFormIds: new Set(["aaaaaaaaaaa"]),
    });
    expect(page.items.map((v) => v.id)).toEqual(["bbbbbbbbbbb", "aaaaaaaaaaa"]);
    expect(api.getChannelVideos).not.toHaveBeenCalled();
  });

  it("leaves paging and per-format listings to the API", async () => {
    const { source, api, innertube } = build();
    await source.getChannelVideos(CHANNEL_ID, { pageToken: "next" });
    await source.getChannelVideos(CHANNEL_ID, { filter: "shorts" });
    expect(api.getChannelVideos).toHaveBeenCalledTimes(2);
    expect(innertube.getUploads).not.toHaveBeenCalled();
  });
});
