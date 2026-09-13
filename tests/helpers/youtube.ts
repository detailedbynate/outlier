import { vi } from "vitest";
import { YouTubeClient } from "@/lib/youtube/client";

/**
 * Test double for the YouTube HTTP API. Payloads below follow the documented
 * Data API v3 response shapes; they are test fixtures only, never used by the app.
 */

export interface FakeRoute {
  /** Endpoint name, e.g. "channels". */
  endpoint: string;
  /** Optional predicate on query params. */
  match?: (params: URLSearchParams) => boolean;
  status?: number;
  body: unknown;
}

export function createFakeYouTube(routes: FakeRoute[]) {
  const calls: { endpoint: string; params: URLSearchParams }[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const endpoint = url.pathname.split("/").at(-1)!;
    calls.push({ endpoint, params: url.searchParams });
    const route = routes.find((r) => r.endpoint === endpoint && (!r.match || r.match(url.searchParams)));
    if (!route) return Response.json({ error: { code: 404, message: `no fake for ${url}` } }, { status: 404 });
    return Response.json(route.body, { status: route.status ?? 200 });
  });

  const quota: { endpoint: string; units: number }[] = [];
  const client = new YouTubeClient({
    apiKey: "test-key",
    fetch: fetchMock as unknown as typeof fetch,
    sleep: async () => {},
    maxRetries: 2,
    onQuotaUsage: (u) => quota.push(u),
  });
  return { client, fetchMock, calls, quota };
}

export function rawChannel(id: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: "youtube#channel",
    id,
    snippet: {
      title: "Google for Developers",
      description: "Subscribe to join a community of creative developers.",
      customUrl: "@googledevelopers",
      publishedAt: "2007-08-23T00:34:43Z",
      thumbnails: { default: { url: "https://yt3.ggpht.com/d" }, high: { url: "https://yt3.ggpht.com/h" } },
      country: "US",
    },
    statistics: { viewCount: "250000000", subscriberCount: "2500000", hiddenSubscriberCount: false, videoCount: "6000" },
    contentDetails: { relatedPlaylists: { uploads: `UU${id.slice(2)}` } },
    brandingSettings: { channel: { keywords: 'developers "google cloud" android' } },
    topicDetails: { topicCategories: ["https://en.wikipedia.org/wiki/Technology"] },
    status: { madeForKids: false },
    ...overrides,
  };
}

export function rawVideo(id: string, overrides: { duration?: string; views?: string; live?: string; channelId?: string } = {}) {
  return {
    kind: "youtube#video",
    id,
    snippet: {
      publishedAt: "2026-09-01T12:00:00Z",
      channelId: overrides.channelId ?? "UC_x5XG1OV2P6uZZ5FSM9Ttw",
      channelTitle: "Google for Developers",
      title: `Video ${id}`,
      description: "desc",
      thumbnails: { medium: { url: `https://i.ytimg.com/vi/${id}/mq.jpg` } },
      tags: ["tag"],
      categoryId: "28",
      liveBroadcastContent: overrides.live ?? "none",
    },
    contentDetails: { duration: overrides.duration ?? "PT10M5S", definition: "hd", caption: "true" },
    statistics: { viewCount: overrides.views ?? "1000", likeCount: "50", commentCount: "10" },
    status: { privacyStatus: "public", madeForKids: false },
  };
}

export function listBody(items: unknown[], extra: Record<string, unknown> = {}) {
  return { kind: "youtube#listResponse", items, pageInfo: { totalResults: items.length, resultsPerPage: 50 }, ...extra };
}
