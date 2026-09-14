import type { DatabaseClient } from "@/lib/database/client";
import { assertOk, unwrap, unwrapMaybe } from "@/lib/database/errors";
import type { TablesInsert, UserPreferencesRow } from "@/types/database";

export class PreferencesRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findByUserId(userId: string): Promise<UserPreferencesRow | null> {
    return unwrapMaybe(
      await this.db.from("user_preferences").select("*").eq("user_id", userId).maybeSingle(),
      "user_preferences.find",
    );
  }

  async upsert(row: TablesInsert<"user_preferences">): Promise<UserPreferencesRow> {
    return unwrap(
      await this.db.from("user_preferences").upsert(row, { onConflict: "user_id" }).select("*").single(),
      "user_preferences.upsert",
    );
  }

  /** Clear answers and the completion flag so the user goes through onboarding again. */
  async reset(userId: string): Promise<void> {
    assertOk(
      await this.db
        .from("user_preferences")
        .update({
          goals: [],
          content_formats: [],
          niches: [],
          has_channel: null,
          channel: null,
          competitors: [],
          onboarding_completed_at: null,
        })
        .eq("user_id", userId),
      "user_preferences.reset",
    );
  }
}
