import type { DatabaseClient } from "@/lib/database/client";
import { assertOk, unwrap } from "@/lib/database/errors";
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

  async creditsSpentSince(userId: string, since: Date): Promise<number> {
    const rows = unwrap(
      await this.db
        .from("usage_events")
        .select("credits_cost")
        .eq("user_id", userId)
        .gt("credits_cost", 0)
        .gte("occurred_at", since.toISOString()),
      "usage_events.creditsSpentSince",
    );
    return rows.reduce((sum, row) => sum + row.credits_cost, 0);
  }

  async hasEventSince(userId: string, eventType: string, resourceId: string, since: Date): Promise<boolean> {
    const result = await this.db
      .from("usage_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("event_type", eventType)
      .eq("resource_id", resourceId)
      .gte("occurred_at", since.toISOString());
    assertOk(result, "usage_events.hasEventSince");
    return (result.count ?? 0) > 0;
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

  /** A user's most recent events, newest first. */
  async recentForUser(userId: string, limit: number, eventTypes?: string[]): Promise<UsageEventRow[]> {
    let query = this.db.from("usage_events").select("*").eq("user_id", userId);
    if (eventTypes) query = query.in("event_type", eventTypes);
    return unwrap(await query.order("occurred_at", { ascending: false }).limit(limit), "usage_events.recentForUser");
  }

  async countForUserSince(userId: string, eventTypes: string[], since: Date): Promise<number> {
    const result = await this.db
      .from("usage_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("event_type", eventTypes)
      .gte("occurred_at", since.toISOString());
    assertOk(result, "usage_events.countForUserSince");
    return result.count ?? 0;
  }

  async creditBalance(workspaceId: string): Promise<number> {
    const rows = unwrap(
      await this.db.from("workspace_credit_balances").select("*").eq("workspace_id", workspaceId).limit(1),
      "credits.balance",
    );
    return Number(rows[0]?.balance ?? 0);
  }
}
