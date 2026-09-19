import { isAppError } from "@/lib/core/errors";
import { createLogger } from "@/lib/core/logger";
import type { ChannelYouTubeSource } from "@/lib/services/channel-service";
import { CHANNEL_ID_PATTERN } from "@/lib/youtube/parse";
import { isQuotaUnavailable } from "@/lib/youtube/quota-manager";
import type { PageOptions, YouTubeService } from "@/lib/youtube/service";
import type { ChannelVideoFilter, Page, YouTubeChannel, YouTubeVideo } from "@/types/youtube";
import { InnerTubeBlockedError, type InnerTubeGate } from "./gate";
import type { InnerTubeSource } from "./source";

const log = createLogger({ module: "innertube.hybrid" });

export interface HybridOptions {
  /**
   * Whether a failed scrape may be retried on the official API. The API has its
   * own daily quota tracker (`QuotaManager`), so a fallback can still be refused
   * there; that refusal is passed through rather than worked around.
   */
  apiFallback?: boolean;
}

/**
 * Channel reads for the scraper: InnerTube first, the official Data API as a
 * controlled fallback. Channel pages and upload lists are free; exact video
 * stats cost one quota unit per 50 videos, because listing pages only show
 * rounded view counts.
 *
 * The gate decides when scraping is allowed at all — this class only decides
 * which side answers, and never retries (that is the gate's job too).
 */
export class HybridYouTubeSource implements ChannelYouTubeSource {
  /** Requests answered by each side since the last `takeCounts()`. */
  private counts = { innertube: 0, api: 0, refusedByQuota: 0 };

  constructor(
    private readonly innertube: InnerTubeSource,
    private readonly api: YouTubeService,
    private readonly gate: InnerTubeGate,
    private readonly options: HybridOptions = {},
  ) {}

  takeCounts(): { innertube: number; api: number; refusedByQuota: number } {
    const counts = this.counts;
    this.counts = { innertube: 0, api: 0, refusedByQuota: 0 };
    return counts;
  }

  /** True while the breaker is open, i.e. the API is carrying everything. */
  get paused(): boolean {
    return this.gate.state().open;
  }

  private async api1<T>(what: string, call: () => Promise<T>): Promise<T> {
    this.counts.api += 1;
    try {
      return await call();
    } catch (error) {
      if (isQuotaUnavailable(error)) {
        this.counts.refusedByQuota += 1;
        log.warn("api fallback refused: daily quota", { what });
      }
      throw error;
    }
  }

  private async withFallback<T>(what: string, scraped: () => Promise<T>, official: () => Promise<T>): Promise<T> {
    try {
      const result = await scraped();
      this.counts.innertube += 1;
      return result;
    } catch (error) {
      // A missing channel is missing on both sides. A block means the gate has paused
      // scraping: let the API carry this read, and the caller sees the pause in `paused`.
      if (isAppError(error) && error.code === "NOT_FOUND") throw error;
      if (!this.options.apiFallback) throw error;
      if (error instanceof InnerTubeBlockedError) log.info("innertube paused, using the API", { what });
      else log.warn("innertube read failed, using the API", { what, error });
      return this.api1(what, official);
    }
  }

  getChannel(identifier: string): Promise<YouTubeChannel> {
    // Handles and legacy URLs need the API's lookup endpoints.
    if (!CHANNEL_ID_PATTERN.test(identifier)) return this.api1(`channel ${identifier}`, () => this.api.getChannel(identifier));
    return this.withFallback(
      `channel ${identifier}`,
      () => this.innertube.getChannel(identifier),
      () => this.api.getChannel(identifier),
    );
  }

  getChannels(channelIds: readonly string[]): Promise<YouTubeChannel[]> {
    // One API call covers 50 channels for a single unit; scraping 50 pages would be worse for everyone.
    return this.api1(`channels x${channelIds.length}`, () => this.api.getChannels(channelIds));
  }

  getChannelPlaylists(channelId: string, options?: PageOptions) {
    return this.api1(`playlists ${channelId}`, () => this.api.getChannelPlaylists(channelId, options));
  }

  async getChannelVideos(channelId: string, options: PageOptions & { filter?: ChannelVideoFilter } = {}): Promise<Page<YouTubeVideo>> {
    // Paging and per-format listings stay on the API; the scraper only reads the latest uploads.
    if (options.pageToken || (options.filter && options.filter !== "all")) {
      return this.api1(`uploads ${channelId}`, () => this.api.getChannelVideos(channelId, options));
    }
    return this.withFallback(
      `uploads ${channelId}`,
      async () => {
        const uploads = await this.innertube.getUploads(channelId);
        const ids = uploads.ids.slice(0, options.maxResults ?? 50);
        // Exact stats, from the one API call the scraper does spend quota on.
        const videos = await this.api.getVideos(ids, { knownShortIds: uploads.shortIds, knownLongFormIds: uploads.longFormIds });
        videos.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
        return { items: videos, nextPageToken: null, prevPageToken: null, totalResults: null };
      },
      () => this.api.getChannelVideos(channelId, options),
    );
  }
}
