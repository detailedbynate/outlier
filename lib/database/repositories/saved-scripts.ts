import "server-only";
import type { DatabaseClient } from "@/lib/database/client";
import { unwrap } from "@/lib/database/errors";
import type { SavedScriptRow } from "@/types/database";

/**
 * Scripts someone has written, newest first.
 *
 * Everything is kept automatically. A script costs eight credits and can only
 * be asked for once every three hours, so a "save" button would just be a way
 * to lose one — deleting the duds is the cheaper mistake to allow.
 */
export class SavedScriptRepository {
  constructor(private readonly db: DatabaseClient) {}

  async listForUser(userId: string, limit = 50): Promise<SavedScriptRow[]> {
    return unwrap(
      await this.db.from("saved_scripts").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit),
      "saved_scripts.listForUser",
    );
  }

  async save(row: Omit<SavedScriptRow, "id" | "created_at">): Promise<SavedScriptRow | null> {
    const rows = unwrap(await this.db.from("saved_scripts").insert(row).select("*"), "saved_scripts.save");
    return rows[0] ?? null;
  }

  /** Scoped by user so one person's id can't delete another's script. */
  async delete(userId: string, id: string): Promise<void> {
    unwrap(await this.db.from("saved_scripts").delete().eq("user_id", userId).eq("id", id).select("id"), "saved_scripts.delete");
  }
}
