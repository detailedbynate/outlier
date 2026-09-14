import type { DatabaseClient } from "@/lib/database/client";
import { assertOk, unwrap } from "@/lib/database/errors";
import type { AccountSettingsRow, ModerationActionRow, TablesInsert } from "@/types/database";

export class ModerationRepository {
  constructor(private readonly db: DatabaseClient) {}

  async log(rows: TablesInsert<"moderation_actions">[]): Promise<void> {
    if (rows.length === 0) return;
    assertOk(await this.db.from("moderation_actions").insert(rows), "moderation.log");
  }

  async recent(limit = 50): Promise<ModerationActionRow[]> {
    return unwrap(await this.db.from("moderation_actions").select("*").order("created_at", { ascending: false }).limit(limit), "moderation.recent");
  }

  /** Every signed-up user, with their settings row when one exists. */
  async listUsers(limit = 1000): Promise<{ id: string; email: string; created_at: string; settings: AccountSettingsRow | null }[]> {
    const [users, settings] = await Promise.all([
      this.db.from("users").select("id, email, created_at").order("created_at", { ascending: false }).limit(limit),
      this.db.from("account_settings").select("*").limit(limit),
    ]);
    const byId = new Map(unwrap(settings, "moderation.settings").map((s) => [s.user_id, s]));
    return unwrap(users, "moderation.users").map((u) => ({ ...u, settings: byId.get(u.id) ?? null }));
  }

  async deleteUser(userId: string): Promise<boolean> {
    return unwrap(await this.db.rpc("delete_user_account", { p_user_id: userId }), "moderation.deleteUser");
  }
}