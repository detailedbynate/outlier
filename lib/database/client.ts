import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/core/env";
import type { Database } from "@/types/database";

export type DatabaseClient = SupabaseClient<Database>;

let adminClient: DatabaseClient | undefined;

/**
 * Service-role client for trusted server code (services, jobs, ingestion).
 * Bypasses RLS — never pass results through to a user without authorization checks.
 */
export function getAdminDatabase(): DatabaseClient {
  adminClient ??= createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-application-name": "yt-intelligence" } },
    },
  );
  return adminClient;
}

/**
 * Client scoped to an end user's JWT, so RLS policies apply.
 * Used once user auth is wired into API routes.
 */
export function getUserDatabase(accessToken: string): DatabaseClient {
  return createClient<Database>(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
