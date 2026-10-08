import type { DatabaseClient } from "@/lib/database/client";
import { assertOk, toDatabaseError, unwrap } from "@/lib/database/errors";
import type { CreatorCodeRow, CreatorCommissionRow, TablesInsert } from "@/types/database";

export class CreatorCodeRepository {
  constructor(private readonly db: DatabaseClient) {}

  async list(): Promise<CreatorCodeRow[]> {
    return unwrap(await this.db.from("creator_codes").select("*").order("created_at", { ascending: false }), "creatorCodes.list");
  }

  async find(code: string): Promise<CreatorCodeRow | null> {
    return unwrap(await this.db.from("creator_codes").select("*").eq("code", code).limit(1), "creatorCodes.find")[0] ?? null;
  }

  async forUser(userId: string): Promise<CreatorCodeRow[]> {
    return unwrap(await this.db.from("creator_codes").select("*").eq("user_id", userId).order("created_at", { ascending: false }), "creatorCodes.forUser");
  }

  /** Insert a code; null when it's taken. */
  async create(row: TablesInsert<"creator_codes">): Promise<CreatorCodeRow | null> {
    const result = await this.db.from("creator_codes").insert(row).select("*").single();
    if (result.error?.code === "23505") return null;
    if (result.error) throw toDatabaseError(result.error, "creatorCodes.create");
    return result.data;
  }

  async setCoupon(id: string, couponId: string): Promise<void> {
    assertOk(await this.db.from("creator_codes").update({ stripe_coupon_id: couponId }).eq("id", id), "creatorCodes.setCoupon");
  }

  /** A new discount for people who check out from now on; its coupon is made at their checkout. */
  async setDiscount(id: string, percent: number, months: number): Promise<void> {
    assertOk(await this.db.from("creator_codes").update({ discount_percent: percent, discount_months: months }).eq("id", id), "creatorCodes.setDiscount");
  }

  async setActive(id: string, active: boolean): Promise<void> {
    assertOk(await this.db.from("creator_codes").update({ active }).eq("id", id), "creatorCodes.setActive");
  }

  /** When this customer's first commission under a code was paid, if any. */
  async firstPaidAt(codeId: string, customerId: string): Promise<Date | null> {
    const rows = unwrap(
      await this.db.from("creator_commissions").select("paid_at").eq("code_id", codeId).eq("stripe_customer_id", customerId).order("paid_at", { ascending: true }).limit(1),
      "creatorCodes.firstPaidAt",
    );
    return rows[0] ? new Date(rows[0].paid_at) : null;
  }

  /** Record one paid invoice; a webhook delivered twice records it once. */
  async recordCommission(row: TablesInsert<"creator_commissions">): Promise<boolean> {
    const result = await this.db.from("creator_commissions").insert(row);
    if (result.error?.code === "23505") return false;
    if (result.error) throw toDatabaseError(result.error, "creatorCodes.recordCommission");
    return true;
  }

  async commissions(codeIds: readonly string[]): Promise<CreatorCommissionRow[]> {
    if (codeIds.length === 0) return [];
    return unwrap(await this.db.from("creator_commissions").select("*").in("code_id", [...codeIds]).limit(10_000), "creatorCodes.commissions");
  }

  /** Mark everything a code has earned so far as paid out. Returns the cents marked. */
  async markPaidOut(codeId: string, at: Date): Promise<number> {
    const rows = unwrap(
      await this.db.from("creator_commissions").update({ paid_out_at: at.toISOString() }).eq("code_id", codeId).is("paid_out_at", null).select("commission_cents"),
      "creatorCodes.markPaidOut",
    );
    return rows.reduce((sum, r) => sum + r.commission_cents, 0);
  }
}
