import "server-only";
import type { DatabaseClient } from "@/lib/database/client";
import { unwrap } from "@/lib/database/errors";
import type { StyleSampleRow } from "@/types/database";

/**
 * Scripts someone pasted in for the writer to learn their voice from.
 *
 * Strictly per user. A sample is somebody's own writing, and it only ever
 * reaches their own generations.
 */
export class StyleSampleRepository {
  constructor(private readonly db: DatabaseClient) {}

  async listForUser(userId: string, limit = 20): Promise<StyleSampleRow[]> {
    return unwrap(
      await this.db.from("style_samples").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit),
      "style_samples.listForUser",
    );
  }

  async add(userId: string, body: string, label: string | null): Promise<StyleSampleRow | null> {
    const rows = unwrap(await this.db.from("style_samples").insert({ user_id: userId, body, label }).select("*"), "style_samples.add");
    return rows[0] ?? null;
  }

  /** Scoped by user so one person's id can't delete another's sample. */
  async delete(userId: string, id: string): Promise<void> {
    unwrap(await this.db.from("style_samples").delete().eq("user_id", userId).eq("id", id).select("id"), "style_samples.delete");
  }
}
