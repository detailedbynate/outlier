import "server-only";
import { env } from "@/lib/core/env";
import { getAdminDatabase } from "@/lib/database/client";
import { SupabaseStorageProvider } from "./supabase-storage";
import type { StorageProvider } from "./types";

export * from "./types";
export { SupabaseStorageProvider } from "./supabase-storage";

let provider: StorageProvider | undefined;

export function getStorage(): StorageProvider {
  provider ??= new SupabaseStorageProvider(getAdminDatabase(), env().SUPABASE_STORAGE_BUCKET);
  return provider;
}
