import { apiHandler } from "@/lib/api/handler";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

/** GET /api/v1/quota — today's YouTube quota budget and usage by lane and operation. */
export const GET = apiHandler({}, async () => getServices().quota.summary());