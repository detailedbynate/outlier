import { apiHandler, ok } from "@/lib/api/handler";
import { idParamsSchema, pageQuerySchema } from "@/lib/api/schemas";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

/** GET /api/v1/playlists/:id?maxResults&pageToken — playlist metadata plus a page of hydrated videos. */
export const GET = apiHandler({ params: idParamsSchema, query: pageQuerySchema }, async ({ params, query }) => {
  const { playlist, videos } = await getServices().discovery.playlist(params.id, query);
  return ok(
    { playlist, videos: videos.items },
    { nextPageToken: videos.nextPageToken, prevPageToken: videos.prevPageToken, totalResults: videos.totalResults },
  );
});
