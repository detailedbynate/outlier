import { z } from "zod";
import { apiHandler, ok } from "@/lib/api/handler";
import { pageQuerySchema } from "@/lib/api/schemas";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

/** GET /api/v1/trending?regionCode=US&videoCategoryId=20&maxResults&pageToken */
export const GET = apiHandler(
  {
    query: pageQuerySchema.extend({
      regionCode: z.string().regex(/^[A-Za-z]{2}$/).transform((v) => v.toUpperCase()).optional(),
      videoCategoryId: z.string().regex(/^\d+$/).optional(),
    }),
  },
  async ({ query }) => {
    const page = await getServices().discovery.trending(query);
    return ok(page.items, { nextPageToken: page.nextPageToken, prevPageToken: page.prevPageToken, totalResults: page.totalResults });
  },
);
