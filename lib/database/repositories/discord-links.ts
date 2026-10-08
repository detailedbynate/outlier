import type { DatabaseClient } from "@/lib/database/client";
import { assertOk, toDatabaseError, unwrap } from "@/lib/database/errors";
import type { DiscordLinkRow } from "@/types/database";

export class DiscordLinkRepository {
  constructor(private readonly db: DatabaseClient) {}

  async forUser(userId: string): Promise<DiscordLinkRow | null> {
    return unwrap(await this.db.from("discord_links").select("*").eq("user_id", userId).limit(1), "discordLinks.forUser")[0] ?? null;
  }

  async forDiscordId(discordId: string): Promise<DiscordLinkRow | null> {
    return unwrap(await this.db.from("discord_links").select("*").eq("discord_id", discordId).limit(1), "discordLinks.forDiscordId")[0] ?? null;
  }

  /**
   * Link an account. A Discord account already linked to someone else moves to
   * this one (whoever just signed in with it owns it), and re-linking replaces
   * the old Discord account.
   */
  async link(userId: string, discordId: string, username: string): Promise<void> {
    assertOk(await this.db.from("discord_links").delete().eq("discord_id", discordId).neq("user_id", userId), "discordLinks.link");
    const result = await this.db
      .from("discord_links")
      .upsert({ user_id: userId, discord_id: discordId, discord_username: username, linked_at: new Date().toISOString(), synced_plan: null, synced_at: null }, { onConflict: "user_id" });
    if (result.error) throw toDatabaseError(result.error, "discordLinks.link");
  }

  async unlink(userId: string): Promise<void> {
    assertOk(await this.db.from("discord_links").delete().eq("user_id", userId), "discordLinks.unlink");
  }

  async markSynced(userId: string, plan: string): Promise<void> {
    assertOk(await this.db.from("discord_links").update({ synced_plan: plan, synced_at: new Date().toISOString() }).eq("user_id", userId), "discordLinks.markSynced");
  }

  async list(): Promise<DiscordLinkRow[]> {
    return unwrap(await this.db.from("discord_links").select("*").order("linked_at", { ascending: false }).limit(5_000), "discordLinks.list");
  }
}
