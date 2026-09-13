import { apiHandler, ok } from "@/lib/api/handler";
import { identifierParamsSchema, pageQuerySchema } from "@/lib/api/schemas";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

/** GET /api/v1/channels/:identifier/playlists?maxResults&pageToken */
export const GET = apiHandler({ params: identifierParamsSchema, query: pageQuerySchema }, async ({ params, query }) => {
  const page = await getServices().channels.listChannelPlaylists(params.identifier, query);
  return ok(page.items, { nextPageToken: page.nextPageToken, prevPageToken: page.prevPageToken, totalResults: page.totalResults });
});
