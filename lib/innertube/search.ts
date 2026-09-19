import { Innertube, Log } from "youtubei.js";
import type { YouTubeSearchResult } from "@/types/youtube";
import type { InnerTubeGate } from "./gate";

/**
 * Search through YouTube's web endpoints. The Data API charges 100 quota units
 * per search, which is what forced the daily caps on discovery and Niche Finder;
 * this costs nothing.
 *
 * It returns ids and titles only. Counts shown in a results list are rounded
 * ("1.2M views"), so callers that rank results hydrate them with one batched
 * `videos.list`/`channels.list` call (1 unit per 50) exactly as before.
 */

export interface ScrapedSearchParams {
  q: string;
  type: "video" | "channel";
  /** Mapped onto YouTube's own sort options; unsupported ones fall back to relevance. */
  order?: "relevance" | "date" | "rating" | "title" | "videoCount" | "viewCount";
  /** Turned into YouTube's upload-date buckets (hour/today/week/month/year). */
  publishedAfter?: string;
  videoDuration?: "any" | "short" | "medium" | "long";
  maxResults?: number;
}

/** The web search's own filter vocabulary (youtubei.js SearchFilters). */
type UploadDate = "all" | "today" | "week" | "month" | "year";
type Prioritize = "relevance" | "popularity";
type WebDuration = "all" | "under_three_mins" | "three_to_twenty_mins" | "over_twenty_mins";

/** Result pages followed for one search (each is a free page read, but not free time). */
const MAX_SEARCH_PAGES = 3;
/** How much longer a follow-up page may wait for its slot than the first page did. */
const CONTINUATION_WAIT_FACTOR = 3;

/**
 * Orders the web search can express. It has no date, title, or videoCount sort,
 * so those keep using the Data API rather than quietly returning something else.
 */
export const SCRAPEABLE_ORDERS = new Set(["relevance", "viewCount", "rating"]);

const PRIORITIZE: Record<string, Prioritize> = { relevance: "relevance", viewCount: "popularity", rating: "popularity" };

/** The API's minute-accurate window becomes the narrowest web bucket that still contains it. */
export function uploadDateBucket(publishedAfter: string | undefined, now: Date = new Date()): UploadDate {
  if (!publishedAfter) return "all";
  const since = Date.parse(publishedAfter);
  if (!Number.isFinite(since)) return "all";
  const hours = (now.getTime() - since) / 3_600_000;
  if (hours <= 24) return "today";
  if (hours <= 24 * 7) return "week";
  if (hours <= 24 * 31) return "month";
  if (hours <= 24 * 366) return "year";
  return "all";
}

/** YouTube's buckets: the API's "short" is under 4 minutes, the web's is under 3. */
export function durationFilter(videoDuration: string | undefined): WebDuration {
  if (videoDuration === "short") return "under_three_mins";
  if (videoDuration === "medium") return "three_to_twenty_mins";
  if (videoDuration === "long") return "over_twenty_mins";
  return "all";
}

/** First value that isn't empty once stringified: nodes carry the title on different fields. */
const text = (...values: unknown[]): string => {
  for (const value of values) {
    const out = value == null ? "" : String(value).trim();
    if (out) return out;
  }
  return "";
};

export class InnerTubeSearch {
  private client: Promise<Innertube> | null = null;

  constructor(
    private readonly gate: InnerTubeGate,
    private readonly locale: { lang: string; location: string } = { lang: "en", location: "US" },
  ) {
    Log.setLevel(Log.Level.NONE);
  }

  private async yt(): Promise<Innertube> {
    this.client ??= Innertube.create({
      retrieve_player: false,
      generate_session_locally: true,
      lang: this.locale.lang,
      location: this.locale.location,
    });
    return this.client;
  }

  /**
   * One page of results. `lane: "user"` jumps the scraper's queue and gives up
   * quickly (`maxWaitMs`) so a waiting person gets the API instead of a queue.
   */
  async search(
    params: ScrapedSearchParams,
    options: { lane?: "user" | "background"; maxWaitMs?: number; now?: Date } = {},
  ): Promise<YouTubeSearchResult[]> {
    const prioritize = PRIORITIZE[params.order ?? "relevance"] ?? "relevance";
    const uploadDate = uploadDateBucket(params.publishedAfter, options.now);
    const duration = durationFilter(params.videoDuration);
    // Shorts have their own search type, which beats filtering long-form results by duration.
    const type = params.type === "video" && params.videoDuration === "short" ? "shorts" : params.type;
    const limit = params.maxResults ?? 25;
    // Filters are part of the key: the same words with a different sort are a different search.
    const cacheKey = `search:${type}:${prioritize}:${uploadDate}:${duration}:${params.q.toLowerCase()}`;

    const parse = params.type === "video" ? videoResults : channelResults;
    const run = <T>(label: string, fn: () => Promise<T>, key?: string, maxWaitMs = options.maxWaitMs) =>
      this.gate.run({ label, cacheKey: key, lane: options.lane, maxWaitMs }, fn);

    let response = await run(`search:${params.q.slice(0, 40)}`, async () => {
      const yt = await this.yt();
      return yt.search(params.q, {
        type,
        // Shorts search returns nothing at all when a sort is attached, so it goes without.
        ...(type === "shorts" ? {} : { prioritize }),
        ...(uploadDate !== "all" ? { upload_date: uploadDate } : {}),
        // The shorts type already implies the length.
        ...(duration !== "all" && type !== "shorts" ? { duration } : {}),
      });
    }, cacheKey);

    const results = parse(response);
    // A page holds about 20 results; follow continuations only if the caller wants more.
    // Later pages may wait a little longer than the first, since results are already in hand.
    const pageWait = options.maxWaitMs === undefined ? undefined : options.maxWaitMs * CONTINUATION_WAIT_FACTOR;
    for (let page = 1; results.length < limit && page < MAX_SEARCH_PAGES; page += 1) {
      if (!response.has_continuation) break;
      const previous = response;
      try {
        response = await run(`search:${params.q.slice(0, 40)}:p${page + 1}`, () => previous.getContinuation(), `${cacheKey}:p${page + 1}`, pageWait);
      } catch {
        // Whatever stopped the next page (busy, a pause, a parse error) doesn't
        // invalidate the results we already have: fewer results beats a 100-unit
        // API search, and an empty first page still falls back.
        break;
      }
      const seen = new Set(results.map((r) => r.id));
      for (const result of parse(response)) if (!seen.has(result.id)) results.push(result);
    }
    return results.slice(0, limit);
  }
}

interface SearchNode {
  type?: string;
  id?: string;
  video_id?: string;
  content_id?: string;
  /** Shorts carry their id on the tap target and their title on the overlay. */
  on_tap_endpoint?: { payload?: { videoId?: string } };
  overlay_metadata?: { primary_text?: unknown };
  title?: unknown;
  description_snippet?: unknown;
  description?: unknown;
  author?: { id?: string; name?: unknown };
  thumbnails?: { url: string }[];
  thumbnail?: { url: string }[];
  published?: unknown;
}

const VIDEO_ID = /^[\w-]{11}$/;
const CHANNEL_ID = /^UC[\w-]{22}$/;

interface Shelf {
  items?: unknown[];
  contents?: unknown[];
}

/**
 * Flatten a results page. Plain video and channel hits sit at the top level,
 * while Shorts come wrapped in a shelf, so shelves are unwrapped one level deep.
 */
function nodes(response: unknown): SearchNode[] {
  const page = (response as { results?: unknown[]; videos?: unknown[]; channels?: unknown[] } | null) ?? {};
  const top = [...(page.results ?? []), ...(page.videos ?? []), ...(page.channels ?? [])];
  return top.flatMap((node) => {
    const shelf = node as Shelf;
    const inner = shelf.items ?? shelf.contents;
    return (Array.isArray(inner) ? inner : [node]) as SearchNode[];
  });
}

function videoResults(response: unknown): YouTubeSearchResult[] {
  const seen = new Set<string>();
  const out: YouTubeSearchResult[] = [];
  for (const node of nodes(response)) {
    const id = node.video_id ?? node.content_id ?? node.on_tap_endpoint?.payload?.videoId ?? node.id;
    if (!id || !VIDEO_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({
      kind: "video",
      id,
      channelId: node.author?.id && CHANNEL_ID.test(node.author.id) ? node.author.id : "",
      channelTitle: text(node.author?.name),
      title: text(node.title, node.overlay_metadata?.primary_text),
      description: text(node.description_snippet, node.description),
      // Listings give a relative date ("3 days ago"); the hydration step brings the real one.
      publishedAt: null,
      thumbnailUrl: node.thumbnails?.[0]?.url ?? node.thumbnail?.[0]?.url ?? null,
      liveBroadcastContent: null,
    });
  }
  return out;
}

function channelResults(response: unknown): YouTubeSearchResult[] {
  const seen = new Set<string>();
  const out: YouTubeSearchResult[] = [];
  for (const node of nodes(response)) {
    const id = node.id ?? node.author?.id;
    if (!id || !CHANNEL_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({
      kind: "channel",
      id,
      channelId: id,
      channelTitle: text(node.title, node.author?.name),
      title: text(node.title, node.author?.name),
      description: text(node.description_snippet, node.description),
      publishedAt: null,
      thumbnailUrl: node.thumbnails?.[0]?.url ?? node.thumbnail?.[0]?.url ?? null,
      liveBroadcastContent: null,
    });
  }
  return out;
}
