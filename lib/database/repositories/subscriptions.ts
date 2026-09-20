import type { DatabaseClient } from "@/lib/database/client";
import { unwrap } from "@/lib/database/errors";
import type { SubscriptionRow, TablesInsert } from "@/types/database";

export class SubscriptionRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findByUserId(userId: string): Promise<SubscriptionRow | null> {
    const rows = unwrap(await this.db.from("subscriptions").select("*").eq("user_id", userId).limit(1), "subscriptions.findByUserId");
    return rows[0] ?? null;
  }

  /** Stripe's webhook knows the customer, not our user id. */
  async findByCustomerId(customerId: string): Promise<SubscriptionRow | null> {
    const rows = unwrap(
      await this.db.from("subscriptions").select("*").eq("stripe_customer_id", customerId).limit(1),
      "subscriptions.findByCustomerId",
    );
    return rows[0] ?? null;
  }

  async upsert(row: TablesInsert<"subscriptions">): Promise<SubscriptionRow> {
    return unwrap(
      await this.db.from("subscriptions").upsert(row, { onConflict: "user_id" }).select("*").single(),
      "subscriptions.upsert",
    );
  }

  async list(limit = 500): Promise<SubscriptionRow[]> {
    return unwrap(
      await this.db.from("subscriptions").select("*").order("updated_at", { ascending: false }).limit(limit),
      "subscriptions.list",
    );
  }
}
