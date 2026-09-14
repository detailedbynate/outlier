import type { DatabaseClient } from "@/lib/database/client";
import { unwrap } from "@/lib/database/errors";
import type { AccountSettingsRow, TablesInsert } from "@/types/database";

export class AccountRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findByUserId(userId: string): Promise<AccountSettingsRow | null> {
    const rows = unwrap(await this.db.from("account_settings").select("*").eq("user_id", userId).limit(1), "accounts.findByUserId");
    return rows[0] ?? null;
  }

  async list(limit = 500): Promise<AccountSettingsRow[]> {
    return unwrap(
      await this.db.from("account_settings").select("*").order("role").order("created_at", { ascending: false }).limit(limit),
      "accounts.list",
    );
  }

  async upsert(row: TablesInsert<"account_settings">): Promise<AccountSettingsRow> {
    return unwrap(
      await this.db.from("account_settings").upsert(row, { onConflict: "user_id" }).select("*").single(),
      "accounts.upsert",
    );
  }

  async update(userId: string, patch: Partial<AccountSettingsRow>): Promise<AccountSettingsRow> {
    return unwrap(await this.db.from("account_settings").update(patch).eq("user_id", userId).select("*").single(), "accounts.update");
  }

  /** Auth user id for an email that already has an account (public.users mirrors auth.users). */
  async userIdByEmail(email: string): Promise<string | null> {
    const rows = unwrap(await this.db.from("users").select("id").ilike("email", email.replace(/[\\%_]/g, (m) => `\\${m}`)).limit(1), "accounts.userIdByEmail");
    return rows[0]?.id ?? null;
  }
}