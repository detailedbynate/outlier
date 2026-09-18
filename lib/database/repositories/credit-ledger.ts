import type { DatabaseClient } from "@/lib/database/client";
import { toDatabaseError, unwrap } from "@/lib/database/errors";
import type { CreditLedgerRow, TablesInsert } from "@/types/database";

/** Credits that don't reset monthly: purchases, owner adjustments, and what's been spent from them. */
export class CreditLedgerRepository {
  constructor(private readonly db: DatabaseClient) {}

  async balance(userId: string): Promise<number> {
    const rows = unwrap(await this.db.from("credit_ledger").select("amount").eq("user_id", userId), "credit_ledger.balance");
    return rows.reduce((sum, row) => sum + row.amount, 0);
  }

  /** Credits drawn from the ledger (not the monthly allowance) since a time. */
  async spentSince(userId: string, since: Date): Promise<number> {
    const rows = unwrap(
      await this.db.from("credit_ledger").select("amount").eq("user_id", userId).eq("kind", "spend").gte("created_at", since.toISOString()),
      "credit_ledger.spentSince",
    );
    return rows.reduce((sum, row) => sum - row.amount, 0);
  }

  /** Adds a row. Returns null when it's a purchase already recorded for that Stripe session. */
  async add(row: TablesInsert<"credit_ledger">): Promise<CreditLedgerRow | null> {
    const result = await this.db.from("credit_ledger").insert(row).select("*").single();
    if (result.error?.code === "23505" && row.stripe_session_id) return null;
    if (result.error) throw toDatabaseError(result.error, "credit_ledger.add");
    return result.data;
  }
}
