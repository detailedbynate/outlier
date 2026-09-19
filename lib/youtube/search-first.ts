import { z } from "zod";
import { ValidationError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";
import { InnerTubeBlockedError, InnerTubeBusyError } from "@/lib/innertube/gate";
import { SCRAPEABLE_ORDERS, type InnerTubeSearch } from "@/lib/innertube/search";
import type { Page, YouTubeSearchResult } from "@/types/youtube";
import type { YouTubeClient } from "./client";
import { searchParamsSchema, YouTubeService, type SearchParams } from "./service";

/**
 * The app's YouTube service with search moved onto YouTube's web endpoints.
 *
 * `search.list` costs 100 quota units per call, which is what forced the daily
 * caps on discovery and Niche Finder; scraped search costs nothing. Only the
 * result *ids* come from scraping — `searchVideos`/`searchChannels` still hydrate
 * them through the Data API (1 unit per 50), so ranking and stored stats keep the
 * exact numbers they had before.
 *
 * Anything the web search can't express faithfully stays on the API: paging by
 * token, searches inside one channel, playlist searches, and the date/title/
 * videoCount orders. So does any search that fails or that arrives while the
 * circuit breaker is open.
 */
export class SearchFirstYouTubeService extends YouTubeService {
  private readonly log: Logger;

  constructor(
    client: YouTubeClient,
    private readonly scraped: InnerTubeSearch,
    private readonly options: { maxWaitMs: number } = { maxWaitMs: 2_000 },
    logger?: Logger,
  ) {
    super(client);
    this.log = logger ?? createLogger({ module: "youtube.search" });
  }

  override async search(params: SearchParams): Promise<Page<YouTubeSearchResult>> {
    const parsed = searchParamsSchema.safeParse(params);
    if (!parsed.success) throw new ValidationError("Invalid search parameters", z.treeifyError(parsed.error));
    const p = parsed.data;

    if (!this.canScrape(p)) return super.search(params);

    try {
      const items = await this.scraped.search(
        {
          q: p.q!,
          type: p.type === "channel" ? "channel" : "video",
          order: p.order,
          publishedAfter: p.publishedAfter,
          videoDuration: p.videoDuration,
          maxResults: p.maxResults,
        },
        // Someone is usually waiting on a search, so it jumps the scraper's queue
        // and gives up quickly rather than making them wait for a slot.
        { lane: "user", maxWaitMs: this.options.maxWaitMs },
      );
      if (items.length === 0) {
        this.log.warn("scraped search came back empty, using the API", { q: p.q, type: p.type });
        return super.search(params);
      }
      // Continuation tokens aren't the API's page tokens, so a scraped search is one page.
      return { items, nextPageToken: null, prevPageToken: null, totalResults: null };
    } catch (error) {
      const expected = error instanceof InnerTubeBusyError || error instanceof InnerTubeBlockedError;
      if (expected) this.log.info("search fell back to the API", { reason: error.name });
      else this.log.warn("scraped search failed, using the API", { q: p.q, error });
      return super.search(params);
    }
  }

  private canScrape(p: z.output<typeof searchParamsSchema>): boolean {
    return (
      Boolean(p.q) &&
      !p.pageToken &&
      // A search restricted to one channel is a different endpoint on the web.
      !p.channelId &&
      p.type !== "playlist" &&
      SCRAPEABLE_ORDERS.has(p.order) &&
      // Category ids are an API concept with no web filter.
      !p.videoCategoryId
    );
  }
}
