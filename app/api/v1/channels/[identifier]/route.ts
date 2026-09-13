import { z } from "zod";
import { apiHandler, ok } from "@/lib/api/handler";
import { booleanQuery, identifierParamsSchema } from "@/lib/api/schemas";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/channels/:identifier — channel id, @handle, or URL-encoded channel URL.
 * ?sync=true also persists the channel and a statistics snapshot.
 */
export const GET = apiHandler(
  { params: identifierParamsSchema, query: z.object({ sync: booleanQuery }) },
  async ({ params, query }) => {
    const { channels } = getServices();
    if (query.sync) {
      const { channel, snapshotCreated } = await channels.syncChannel(params.identifier);
      return ok(channel, { persisted: true, snapshotCreated });
    }
    return channels.lookupChannel(params.identifier);
  },
);
