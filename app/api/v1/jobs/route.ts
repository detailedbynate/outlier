import { z } from "zod";
import { apiHandler, ok } from "@/lib/api/handler";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

const enqueueBodySchema = z.object({
  type: z.string().min(1).max(100),
  payload: z.record(z.string(), z.unknown()).default({}),
  priority: z.number().int().min(-100).max(100).optional(),
  runAt: z.iso.datetime({ offset: true }).optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

/** POST /api/v1/jobs — enqueue a background job. Payload is validated against the job type's schema. */
export const POST = apiHandler({ body: enqueueBodySchema }, async ({ body, principal }) => {
  const { job, created } = await getServices().jobs.enqueue(body.type, body.payload, {
    priority: body.priority,
    runAt: body.runAt ? new Date(body.runAt) : undefined,
    idempotencyKey: body.idempotencyKey,
    workspaceId: principal?.workspaceId ?? null,
    createdBy: principal?.userId ?? null,
  });
  return ok(job, { created }, created ? 201 : 200);
});

/** GET /api/v1/jobs — list registered job types. */
export const GET = apiHandler({}, async () => getServices().jobRegistry.types());
