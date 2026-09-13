import { z } from "zod";
import { apiHandler, ok } from "@/lib/api/handler";
import { identifierParamsSchema, pageQuerySchema } from "@/lib/api/schemas";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

/** GET /api/v1/channels/:identifier/videos?filter=all|shorts|long_form&maxResults&pageToken */
export const GET = apiHandler(
  {
    params: identifierParamsSchema,
    query: pageQuerySchema.extend({ filter: z.enum(["all", "shorts", "long_form"]).default("all") }),
  },
  async ({ params, query }) => {
    const page = await getServices().channels.listChannelVideos(params.identifier, query);
    return ok(page.items, { nextPageToken: page.nextPageToken, prevPageToken: page.prevPageToken, totalResults: page.totalResults });
  },
);
