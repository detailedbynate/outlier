import type { DatabaseClient } from "@/lib/database/client";
import { unwrap } from "@/lib/database/errors";
import type { TablesInsert, UsageEventRow } from "@/types/database";

export class UsageRepository {
  constructor(private readonly db: DatabaseClient) {}

  async record(event: TablesInsert<"usage_events">): Promise<UsageEventRow> {
    return unwrap(await this.db.from("usage_events").insert(event).select("*").single(), "usage_events.insert");
  }

  async creditBalance(workspaceId: string): Promise<number> {
    const rows = unwrap(
      await this.db.from("workspace_credit_balances").select("*").eq("workspace_id", workspaceId).limit(1),
      "credits.balance",
    );
    return Number(rows[0]?.balance ?? 0);
  }
}
