import type { DatabaseClient } from "@/lib/database/client";
import { unwrap } from "@/lib/database/errors";
import type { TablesInsert, UsageEventRow } from "@/types/database";

export class UsageRepository {
  constructor(private readonly db: DatabaseClient) {}

  async record(event: TablesInsert<"usage_events">): Promise<UsageEventRow> {
    return unwrap(await this.db.from("usage_events").insert(event).select("*").single(), "usage_events.insert");
  }

  /** Total quantity of an event type since a point in time (for daily limits). */
  async countSince(eventType: string, since: Date): Promise<number> {
    const rows = unwrap(
      await this.db.from("usage_events").select("quantity").eq("event_type", eventType).gte("occurred_at", since.toISOString()),
      "usage_events.countSince",
    );
    return rows.reduce((sum, row) => sum + row.quantity, 0);
  }

  /** Most frequent `resource_id` values for an event type since a point in time (e.g. popular search keywords). */
  async topResources(eventType: string, since: Date, limit: number): Promise<string[]> {
    const rows = unwrap(
      await this.db
        .from("usage_events")
        .select("resource_id")
        .eq("event_type", eventType)
        .gte("occurred_at", since.toISOString())
        .not("resource_id", "is", null)
        .limit(1000),
      "usage_events.topResources",
    );
    const counts = new Map<string, number>();
    for (const { resource_id } of rows) {
      const key = resource_id!.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key]) => key);
  }

  async creditBalance(workspaceId: string): Promise<number> {
    const rows = unwrap(
      await this.db.from("workspace_credit_balances").select("*").eq("workspace_id", workspaceId).limit(1),
      "credits.balance",
    );
    return Number(rows[0]?.balance ?? 0);
  }
}
