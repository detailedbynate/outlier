import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { booleanQuery, idParamsSchema } from "@/lib/api/schemas";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/videos/:id — video id (or URL-encoded video URL).
 * ?analyze=true adds performance metrics against the channel's recent uploads.
 */
export const GET = apiHandler(
  { params: idParamsSchema, query: z.object({ analyze: booleanQuery }) },
  async ({ params, query }) => {
    const { videos } = getServices();
    return query.analyze ? videos.analyzeVideo(params.id) : videos.getVideo(params.id);
  },
);
