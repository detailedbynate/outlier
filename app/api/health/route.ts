import { apiHandler } from "@/lib/api/handler";
import { env } from "@/lib/core/env";

export const dynamic = "force-dynamic";

export const GET = apiHandler({ auth: "public" }, async () => {
  const config = env();
  return {
    status: "ok",
    time: new Date().toISOString(),
    // Report only whether integrations are configured — never values.
    integrations: {
      youtube: Boolean(config.YOUTUBE_API_KEY),
      supabase: Boolean(config.NEXT_PUBLIC_SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY),
      apiKeyRequired: Boolean(config.INTERNAL_API_KEY),
    },
  };
});
