import { apiHandler } from "@/lib/api/handler";
import { uuidParamsSchema } from "@/lib/api/schemas";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

/** GET /api/v1/jobs/:id — job status plus results once succeeded. */
export const GET = apiHandler({ params: uuidParamsSchema }, async ({ params }) => getServices().jobs.get(params.id));

/** DELETE /api/v1/jobs/:id — cancel a job that hasn't started. */
export const DELETE = apiHandler({ params: uuidParamsSchema }, async ({ params }) => getServices().jobs.cancel(params.id));
