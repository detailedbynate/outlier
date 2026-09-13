import { apiHandler, ok } from "@/lib/api/handler";
import { booleanQuery } from "@/lib/api/schemas";
import { getServices } from "@/lib/services";
import { searchParamsSchema } from "@/lib/youtube/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/search?q=...&type=video|channel|playlist&order&publishedAfter&regionCode&videoDuration...
 * ?hydrate=true returns full videos/channels with statistics (extra 1 quota unit).
 * Each search costs 100 YouTube quota units.
 */
export const GET = apiHandler(
  { query: searchParamsSchema.extend({ hydrate: booleanQuery }) },
  async ({ query: { hydrate, ...params } }) => {
    const { discovery } = getServices();
    const page =
      hydrate && params.type === "video"
        ? await discovery.searchVideos(params)
        : hydrate && params.type === "channel"
          ? await discovery.searchChannels(params)
          : await discovery.search(params);
    return ok(page.items as unknown[], {
      nextPageToken: page.nextPageToken,
      prevPageToken: page.prevPageToken,
      totalResults: page.totalResults,
    });
  },
);
