import { createLogger, type Logger } from "@/lib/core/logger";
import type { ReferralRepository } from "@/lib/database/repositories/referrals";
import type { WaitlistRepository } from "@/lib/database/repositories/waitlist";
import type { ReferralCodeRow, WaitlistEntryRow } from "@/types/database";
import { startOfUtcMonth } from "./credits-service";

/**
 * Referrals. Everyone gets a shareable code: waitlist signups get one when they
 * join, and it follows them to their account. People who join through a code
 * are credited to the referrer (priority access on the waitlist). When a
 * referred person creates an account, they get bonus credits, and so does the
 * referrer (immediately if they have an account, otherwise once they do).
 */

export const REFERRAL_CODE_PATTERN = /^[a-z0-9]{6,16}$/;
export const REFERRED_REASON = "referral_welcome";
export const REFERRER_REASON = "referral_reward";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no look-alike characters
const CODE_LENGTH = 8;

export interface ReferralConfig {
  referrerCredits: number;
  referredCredits: number;
  priorityThreshold: number;
  maxRewardsPerMonth: number;
}

export interface ReferralSummary {
  code: string;
  signups: number;
  accounts: number;
  creditsEarned: number;
  pendingRewards: number;
  priority: boolean;
  threshold: number;
  referrerCredits: number;
  referredCredits: number;
}

export function generateReferralCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return [...random(CODE_LENGTH)].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

export function normalizeReferralCode(value: string | null | undefined): string | null {
  const code = (value ?? "").trim().toLowerCase();
  return REFERRAL_CODE_PATTERN.test(code) ? code : null;
}

export class ReferralService {
  private readonly log: Logger;

  constructor(
    private readonly deps: {
      referrals: Pick<
        ReferralRepository,
        | "findCode"
        | "codeForEntry"
        | "codeForUser"
        | "createCode"
        | "attachUser"
        | "setReferredBy"
        | "countSignups"
        | "insertReward"
        | "pendingReferrerRewards"
        | "markReferrerRewarded"
        | "referrerRewardsSince"
        | "rewardsForCode"
        | "grant"
        | "creditsEarned"
      >;
      waitlist: Pick<WaitlistRepository, "findByEmail" | "findById">;
      userIdByEmail: (email: string) => Promise<string | null>;
      generate?: () => string;
    },
    private readonly config: ReferralConfig,
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger({ module: "services.referrals" });
  }

  /** A waitlist signup's code, created on first use. */
  async codeForEntry(entryId: string): Promise<string> {
    const existing = await this.deps.referrals.codeForEntry(entryId);
    if (existing) return existing.code;
    return this.createCode({ waitlist_entry_id: entryId }, () => this.deps.referrals.codeForEntry(entryId));
  }

  /** An account's code: their waitlist code if they have one, otherwise a new one. */
  async codeForUser(userId: string, email: string | null): Promise<string> {
    const existing = await this.deps.referrals.codeForUser(userId);
    if (existing) return existing.code;
    const entry = email ? await this.deps.waitlist.findByEmail(email) : null;
    if (entry) {
      const entryCode = await this.deps.referrals.codeForEntry(entry.id);
      if (entryCode && !entryCode.user_id) {
        await this.deps.referrals.attachUser(entryCode.code, userId);
        return entryCode.code;
      }
    }
    return this.createCode({ user_id: userId }, () => this.deps.referrals.codeForUser(userId));
  }

  /** After a waitlist signup: remember the referrer (ignoring self-referrals) and return the signup's own code. */
  async recordSignup(entry: WaitlistEntryRow, rawCode: string | null, isNewSignup: boolean): Promise<string> {
    const ownCode = await this.codeForEntry(entry.id);
    const code = normalizeReferralCode(rawCode);
    if (isNewSignup && code && code !== ownCode) {
      const row = await this.deps.referrals.findCode(code);
      if (row && !(await this.ownsCode(row, entry))) {
        await this.deps.referrals.setReferredBy(entry.id, code);
        this.log.info("waitlist referral recorded", { code });
      }
    }
    return ownCode;
  }

  /** Public progress for a code (only counts, no personal details). */
  async publicStatus(rawCode: string): Promise<{ code: string; signups: number; threshold: number; priority: boolean } | null> {
    const code = normalizeReferralCode(rawCode);
    if (!code || !(await this.deps.referrals.findCode(code))) return null;
    const signups = await this.deps.referrals.countSignups(code);
    return { code, signups, threshold: this.config.priorityThreshold, priority: signups >= this.config.priorityThreshold };
  }

  async summary(userId: string, email: string | null): Promise<ReferralSummary> {
    const code = await this.codeForUser(userId, email);
    const [signups, rewards, creditsEarned] = await Promise.all([
      this.deps.referrals.countSignups(code),
      this.deps.referrals.rewardsForCode(code),
      this.deps.referrals.creditsEarned(userId, [REFERRER_REASON]),
    ]);
    return {
      code,
      signups,
      accounts: rewards.length,
      creditsEarned,
      pendingRewards: rewards.filter((r) => !r.referrer_rewarded_at).length,
      priority: signups >= this.config.priorityThreshold,
      threshold: this.config.priorityThreshold,
      referrerCredits: this.config.referrerCredits,
      referredCredits: this.config.referredCredits,
    };
  }

  /**
   * When someone creates an account (first sign-in from an invite or link):
   * reward them and their referrer, and pay out rewards they earned while still
   * on the waitlist. Safe to call more than once.
   */
  async onAccountCreated(userId: string, email: string, now: Date = new Date()): Promise<void> {
    try {
      const ownCode = await this.codeForUser(userId, email);
      const entry = await this.deps.waitlist.findByEmail(email);

      if (entry?.referred_by_code) {
        const codeRow = await this.deps.referrals.findCode(entry.referred_by_code);
        const referrerUserId = codeRow ? await this.ownerUserId(codeRow) : null;
        if (codeRow && referrerUserId !== userId) {
          const reward = await this.deps.referrals.insertReward({
            code: codeRow.code,
            referred_user_id: userId,
            referred_credits: this.config.referredCredits,
          });
          if (reward) {
            await this.deps.referrals.grant(userId, this.config.referredCredits, REFERRED_REASON, reward.id);
            if (referrerUserId) await this.payReferrer(reward.id, referrerUserId, now);
            this.log.info("referral converted", { code: codeRow.code, referrerHasAccount: Boolean(referrerUserId) });
          }
        }
      }

      // Rewards earned while this person was still on the waitlist.
      for (const pending of await this.deps.referrals.pendingReferrerRewards(ownCode)) {
        if (pending.referred_user_id !== userId) await this.payReferrer(pending.id, userId, now);
      }
    } catch (error) {
      // Never block sign-in because of referral bookkeeping.
      this.log.error("referral processing failed", { error });
    }
  }

  private async payReferrer(rewardId: string, referrerUserId: string, now: Date): Promise<void> {
    const thisMonth = await this.deps.referrals.referrerRewardsSince(referrerUserId, startOfUtcMonth(now));
    if (thisMonth >= this.config.maxRewardsPerMonth) {
      this.log.info("referral reward capped for the month", { referrerUserId });
      return;
    }
    const granted = await this.deps.referrals.grant(referrerUserId, this.config.referrerCredits, REFERRER_REASON, rewardId);
    await this.deps.referrals.markReferrerRewarded(rewardId, referrerUserId, granted ? this.config.referrerCredits : 0, now);
  }

  private async ownerUserId(row: ReferralCodeRow): Promise<string | null> {
    if (row.user_id) return row.user_id;
    if (!row.waitlist_entry_id) return null;
    const owner = await this.deps.waitlist.findById(row.waitlist_entry_id);
    return owner ? this.deps.userIdByEmail(owner.email) : null;
  }

  private async ownsCode(row: ReferralCodeRow, entry: WaitlistEntryRow): Promise<boolean> {
    if (row.waitlist_entry_id === entry.id) return true;
    if (row.waitlist_entry_id) {
      const owner = await this.deps.waitlist.findById(row.waitlist_entry_id);
      if (owner?.email.toLowerCase() === entry.email.toLowerCase()) return true;
    }
    if (row.user_id) return (await this.deps.userIdByEmail(entry.email)) === row.user_id;
    return false;
  }

  private async createCode(owner: { waitlist_entry_id?: string; user_id?: string }, reload: () => Promise<ReferralCodeRow | null>): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const created = await this.deps.referrals.createCode({ code: (this.deps.generate ?? generateReferralCode)(), ...owner });
      if (created) return created.code;
      // Either the random code collided or another request created this owner's code first.
      const existing = await reload();
      if (existing) return existing.code;
    }
    throw new Error("Could not create a referral code");
  }
}
