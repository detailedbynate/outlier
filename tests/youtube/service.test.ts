import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/core/errors";
import { YouTubeService } from "@/lib/youtube/service";
import { createFakeYouTube, listBody, rawChannel, rawVideo } from "../helpers/youtube";

const CHANNEL_ID = "UC_x5XG1OV2P6uZZ5FSM9Ttw";

describe("YouTubeService", () => {
  it("resolves a channel by handle and maps statistics", async () => {
    const { client, calls, quota } = createFakeYouTube([
      { endpoint: "channels", match: (p) => p.get("forHandle") === "@googledevelopers", body: listBody([rawChannel(CHANNEL_ID)]) },
    ]);
    const channel = await new YouTubeService(client).getChannel("https://www.youtube.com/@googledevelopers");

    expect(channel).toMatchObject({
      id: CHANNEL_ID,
      handle: "@googledevelopers",
      thumbnailUrl: "https://yt3.ggpht.com/h",
      uploadsPlaylistId: "UU_x5XG1OV2P6uZZ5FSM9Ttw",
      keywords: ["developers", "google cloud", "android"],
      statistics: { subscriberCount: 2_500_000, viewCount: 250_000_000, videoCount: 6000, hiddenSubscriberCount: false },
    });
    expect(calls[0]!.params.get("key")).toBe("test-key");
    expect(calls[0]!.params.get("part")).toContain("statistics");
    expect(quota).toEqual([{ endpoint: "channels", units: 1, status: 200 }]);
  });

  it("returns null subscribers when the channel hides them", async () => {
    const hidden = rawChannel(CHANNEL_ID, {
      statistics: { viewCount: "10", subscriberCount: "0", hiddenSubscriberCount: true, videoCount: "1" },
    });
    const { client } = createFakeYouTube([{ endpoint: "channels", body: listBody([hidden]) }]);
    const channel = await new YouTubeService(client).getChannel(CHANNEL_ID);
    expect(channel.statistics.subscriberCount).toBeNull();
  });

  it("throws NOT_FOUND for unknown channels", async () => {
    const { client } = createFakeYouTube([{ endpoint: "channels", body: listBody([]) }]);
    await expect(new YouTubeService(client).getChannel("@nobody-here")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("batches video lookups in groups of 50 and preserves input order", async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `vid${String(i).padStart(8, "0")}`);
    const { client, fetchMock } = createFakeYouTube([]);
    const batchSizes: number[] = [];
    // Respond with the requested ids in reverse to prove order is restored.
    fetchMock.mockImplementation(async (input) => {
      const requested = new URL(String(input)).searchParams.get("id")!.split(",");
      batchSizes.push(requested.length);
      return Response.json(listBody(requested.toReversed().map((id) => rawVideo(id))));
    });

    const videos = await new YouTubeService(client).getVideos(ids);
    expect(videos.map((v) => v.id)).toEqual(ids);
    expect(batchSizes).toEqual([50, 10]);
  });

  it("classifies formats from live status, Shorts playlist, and duration", async () => {
    const { client } = createFakeYouTube([
      {
        endpoint: "videos",
        body: listBody([
          rawVideo("live0000000", { live: "live", duration: "P0D" }),
          rawVideo("short000000", { duration: "PT45S" }),
          rawVideo("long0000000", { duration: "PT12M" }),
        ]),
      },
    ]);
    const videos = await new YouTubeService(client).getVideos(["live0000000", "short000000", "long0000000"]);
    expect(videos.map((v) => [v.id, v.format, v.formatSource])).toEqual([
      ["live0000000", "live", "live_status"],
      ["short000000", "short", "duration_heuristic"],
      ["long0000000", "long_form", "duration_heuristic"],
    ]);
  });

  it("lists channel Shorts via the UUSH playlist and marks them authoritatively", async () => {
    const { client, calls } = createFakeYouTube([
      {
        endpoint: "playlistItems",
        match: (p) => p.get("playlistId") === "UUSH_x5XG1OV2P6uZZ5FSM9Ttw",
        body: listBody(
          [{ id: "pi1", snippet: { playlistId: "UUSH_x5XG1OV2P6uZZ5FSM9Ttw", position: 0 }, contentDetails: { videoId: "short000000" } }],
          { nextPageToken: "NEXT" },
        ),
      },
      // 4-minute Short: duration alone would misclassify it.
      { endpoint: "videos", body: listBody([rawVideo("short000000", { duration: "PT3M59S" })]) },
    ]);
    const page = await new YouTubeService(client).getChannelShorts(CHANNEL_ID, { maxResults: 10 });
    expect(page.nextPageToken).toBe("NEXT");
    expect(page.items[0]).toMatchObject({ id: "short000000", format: "short", formatSource: "shorts_playlist" });
    expect(calls.map((c) => c.endpoint)).toEqual(["playlistItems", "videos"]);
  });

  it("returns an empty page when a channel has no Shorts playlist", async () => {
    const { client } = createFakeYouTube([
      { endpoint: "playlistItems", status: 404, body: { error: { code: 404, message: "not found", errors: [{ reason: "playlistNotFound" }] } } },
    ]);
    const page = await new YouTubeService(client).getChannelShorts(CHANNEL_ID);
    expect(page).toEqual({ items: [], nextPageToken: null, prevPageToken: null, totalResults: 0 });
  });

  it("maps search results and charges 100 quota units", async () => {
    const { client, calls, quota } = createFakeYouTube([
      {
        endpoint: "search",
        body: listBody([
          { id: { kind: "youtube#video", videoId: "abcdefghijk" }, snippet: { title: "t", channelId: CHANNEL_ID } },
          { id: { kind: "youtube#channel", channelId: CHANNEL_ID }, snippet: { title: "c" } },
          { id: { kind: "youtube#unknown" } },
        ]),
      },
    ]);
    const page = await new YouTubeService(client).search({ q: "ai tools", type: "video", order: "viewCount", regionCode: "us" });
    expect(page.items.map((i) => [i.kind, i.id])).toEqual([
      ["video", "abcdefghijk"],
      ["channel", CHANNEL_ID],
    ]);
    expect(calls[0]!.params.get("regionCode")).toBe("US");
    expect(quota[0]!.units).toBe(100);
  });

  it("validates search parameters before spending quota", async () => {
    const { client, fetchMock } = createFakeYouTube([]);
    const service = new YouTubeService(client);
    await expect(service.search({ type: "video" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(service.search({ q: "x", maxResults: 500 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("YouTubeClient error handling", () => {
  it("maps quotaExceeded to QUOTA_EXCEEDED without retrying", async () => {
    const { client, fetchMock } = createFakeYouTube([
      { endpoint: "videos", status: 403, body: { error: { code: 403, message: "quota", errors: [{ reason: "quotaExceeded" }] } } },
    ]);
    const error = await new YouTubeService(client).getVideo("dQw4w9WgXcQ").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "QUOTA_EXCEEDED", status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries transient 5xx errors then succeeds", async () => {
    let attempt = 0;
    const { client, fetchMock } = createFakeYouTube([]);
    fetchMock.mockImplementation(async () => {
      attempt += 1;
      return attempt < 3
        ? Response.json({ error: { code: 503, errors: [{ reason: "backendError" }] } }, { status: 503 })
        : Response.json(listBody([rawVideo("dQw4w9WgXcQ")]));
    });
    const video = await new YouTubeService(client).getVideo("dQw4w9WgXcQ");
    expect(video.id).toBe("dQw4w9WgXcQ");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("maps 400 responses to BAD_REQUEST", async () => {
    const { client } = createFakeYouTube([
      { endpoint: "channels", status: 400, body: { error: { code: 400, message: "Invalid filter", errors: [{ reason: "badRequest" }] } } },
    ]);
    await expect(new YouTubeService(client).getChannel(CHANNEL_ID)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("hides upstream detail on permission errors", async () => {
    const { client } = createFakeYouTube([
      { endpoint: "channels", status: 403, body: { error: { code: 403, message: "API key restricted to referer x", errors: [{ reason: "forbidden" }] } } },
    ]);
    const error = await new YouTubeService(client).getChannel(CHANNEL_ID).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "UPSTREAM_ERROR", message: "YouTube API rejected the server's credentials" });
  });

  it("rejects malformed success payloads", async () => {
    const { client } = createFakeYouTube([{ endpoint: "channels", body: { items: [{ nope: true }] } }]);
    await expect(new YouTubeService(client).getChannel(CHANNEL_ID)).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
  });
});
