import type { DatabaseClient } from "@/lib/database/client";
import { assertOk, toDatabaseError, unwrap } from "@/lib/database/errors";
import type { ReferralCodeRow, ReferralRewardRow, TablesInsert } from "@/types/database";

export class ReferralRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findCode(code: string): Promise<ReferralCodeRow | null> {
    const rows = unwrap(await this.db.from("referral_codes").select("*").eq("code", code).limit(1), "referrals.findCode");
    return rows[0] ?? null;
  }

  async codeForEntry(entryId: string): Promise<ReferralCodeRow | null> {
    const rows = unwrap(await this.db.from("referral_codes").select("*").eq("waitlist_entry_id", entryId).limit(1), "referrals.codeForEntry");
    return rows[0] ?? null;
  }

  async codeForUser(userId: string): Promise<ReferralCodeRow | null> {
    const rows = unwrap(await this.db.from("referral_codes").select("*").eq("user_id", userId).limit(1), "referrals.codeForUser");
    return rows[0] ?? null;
  }

  /** Insert a code; returns null when the code (or owner) already exists. */
  async createCode(row: TablesInsert<"referral_codes">): Promise<ReferralCodeRow | null> {
    const result = await this.db.from("referral_codes").insert(row).select("*").single();
    if (result.error?.code === "23505") return null;
    if (result.error) throw toDatabaseError(result.error, "referrals.createCode");
    return result.data;
  }

  /** Link a waitlist code to the account that person created (so their link keeps working). */
  async attachUser(code: string, userId: string): Promise<void> {
    assertOk(await this.db.from("referral_codes").update({ user_id: userId }).eq("code", code).is("user_id", null), "referrals.attachUser");
  }

  /** Record which code a signup came through (first referrer wins). */
  async setReferredBy(entryId: string, code: string): Promise<void> {
    assertOk(
      await this.db.from("waitlist_entries").update({ referred_by_code: code }).eq("id", entryId).is("referred_by_code", null),
      "referrals.setReferredBy",
    );
  }

  async countSignups(code: string): Promise<number> {
    const result = await this.db.from("waitlist_entries").select("id", { count: "exact", head: true }).eq("referred_by_code", code);
    assertOk(result, "referrals.countSignups");
    return result.count ?? 0;
  }

  /** Referral signups per code, for the admin waitlist. */
  async signupCountsByCode(): Promise<Map<string, number>> {
    const rows = unwrap(
      await this.db.from("waitlist_entries").select("referred_by_code").not("referred_by_code", "is", null).limit(10_000),
      "referrals.signupCounts",
    );
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.referred_by_code!, (counts.get(r.referred_by_code!) ?? 0) + 1);
    return counts;
  }

  async codesForEntries(entryIds: string[]): Promise<Map<string, string>> {
    if (entryIds.length === 0) return new Map();
    const map = new Map<string, string>();
    for (let i = 0; i < entryIds.length; i += 200) {
      const rows = unwrap(
        await this.db.from("referral_codes").select("code, waitlist_entry_id").in("waitlist_entry_id", entryIds.slice(i, i + 200)),
        "referrals.codesForEntries",
      );
      for (const r of rows) if (r.waitlist_entry_id) map.set(r.waitlist_entry_id, r.code);
    }
    return map;
  }

  /** Returns the reward, or null if this referred account was already rewarded. */
  async insertReward(row: TablesInsert<"referral_rewards">): Promise<ReferralRewardRow | null> {
    const result = await this.db.from("referral_rewards").insert(row).select("*").single();
    if (result.error?.code === "23505") return null;
    if (result.error) throw toDatabaseError(result.error, "referrals.insertReward");
    return result.data;
  }

  async pendingReferrerRewards(code: string): Promise<ReferralRewardRow[]> {
    return unwrap(
      await this.db.from("referral_rewards").select("*").eq("code", code).is("referrer_rewarded_at", null).order("created_at"),
      "referrals.pending",
    );
  }

  async markReferrerRewarded(rewardId: string, referrerUserId: string, credits: number, at: Date): Promise<void> {
    assertOk(
      await this.db
        .from("referral_rewards")
        .update({ referrer_user_id: referrerUserId, referrer_credits: credits, referrer_rewarded_at: at.toISOString() })
        .eq("id", rewardId)
        .is("referrer_rewarded_at", null),
      "referrals.markRewarded",
    );
  }

  async referrerRewardsSince(referrerUserId: string, since: Date): Promise<number> {
    const result = await this.db
      .from("referral_rewards")
      .select("id", { count: "exact", head: true })
      .eq("referrer_user_id", referrerUserId)
      .gte("referrer_rewarded_at", since.toISOString());
    assertOk(result, "referrals.referrerRewardsSince");
    return result.count ?? 0;
  }

  async rewardsForCode(code: string): Promise<ReferralRewardRow[]> {
    return unwrap(await this.db.from("referral_rewards").select("*").eq("code", code), "referrals.rewardsForCode");
  }

  /** Grant bonus credits once per (user, reason, source). Returns false if already granted. */
  async grant(userId: string, amount: number, reason: string, sourceId: string): Promise<boolean> {
    if (amount <= 0) return false;
    const result = await this.db.from("credit_grants").insert({ user_id: userId, amount, reason, source_id: sourceId }).select("id").single();
    if (result.error?.code === "23505") return false;
    if (result.error) throw toDatabaseError(result.error, "referrals.grant");
    return true;
  }

  async bonusSince(userId: string, since: Date): Promise<number> {
    const rows = unwrap(
      await this.db.from("credit_grants").select("amount").eq("user_id", userId).gte("created_at", since.toISOString()),
      "referrals.bonusSince",
    );
    return rows.reduce((sum, r) => sum + r.amount, 0);
  }

  async creditsEarned(userId: string, reasons: string[]): Promise<number> {
    const rows = unwrap(await this.db.from("credit_grants").select("amount").eq("user_id", userId).in("reason", reasons), "referrals.creditsEarned");
    return rows.reduce((sum, r) => sum + r.amount, 0);
  }
}
