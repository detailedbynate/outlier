import { describe, expect, it } from "vitest";
import { createLogger } from "@/lib/core/logger";
import {
  generateReferralCode,
  MILESTONE_REASON,
  normalizeReferralCode,
  REFERRED_REASON,
  REFERRER_REASON,
  type ReferralConfig,
  ReferralService,
} from "@/lib/services/referral-service";
import type { ReferralCodeRow, ReferralRewardRow, WaitlistEntryRow } from "@/types/database";

const NOW = new Date("2026-09-21T12:00:00Z");

function entry(id: string, email: string, referredBy: string | null = null): WaitlistEntryRow {
  return {
    id,
    email,
    name: null,
    channel_url: null,
    niche: null,
    use_case: null,
    source: null,
    status: "pending",
    invited_at: null,
    joined_at: null,
    invited_by: null,
    referred_by_code: referredBy,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  };
}

/** In-memory tables with the same uniqueness rules as the migration. */
const MILESTONES = [
  { at: 1, credits: 75 },
  { at: 3, credits: 100 },
];

function setup(config: ReferralConfig = { referrerCredits: 25, referredCredits: 50, priorityThreshold: 3, maxRewardsPerMonth: 20, milestones: MILESTONES }) {
  const codes: ReferralCodeRow[] = [];
  const entries: WaitlistEntryRow[] = [];
  const rewards: ReferralRewardRow[] = [];
  const grants: { user_id: string; amount: number; reason: string; source_id: string }[] = [];
  const users = new Map<string, string>(); // email -> user id
  let seq = 0;
  const generated: string[] = [];

  const repo = {
    findCode: async (code: string) => codes.find((c) => c.code === code) ?? null,
    codeForEntry: async (id: string) => codes.find((c) => c.waitlist_entry_id === id) ?? null,
    codeForUser: async (id: string) => codes.find((c) => c.user_id === id) ?? null,
    createCode: async (row: Partial<ReferralCodeRow> & { code: string }) => {
      if (codes.some((c) => c.code === row.code || (row.waitlist_entry_id && c.waitlist_entry_id === row.waitlist_entry_id) || (row.user_id && c.user_id === row.user_id))) return null;
      const created = { waitlist_entry_id: null, user_id: null, created_at: NOW.toISOString(), ...row } as ReferralCodeRow;
      codes.push(created);
      return created;
    },
    attachUser: async (code: string, userId: string) => {
      const c = codes.find((x) => x.code === code && !x.user_id);
      if (c) c.user_id = userId;
    },
    setReferredBy: async (entryId: string, code: string) => {
      const e = entries.find((x) => x.id === entryId && !x.referred_by_code);
      if (e) e.referred_by_code = code;
    },
    countSignups: async (code: string) => entries.filter((e) => e.referred_by_code === code).length,
    insertReward: async (row: Partial<ReferralRewardRow> & { code: string; referred_user_id: string }) => {
      if (rewards.some((r) => r.referred_user_id === row.referred_user_id)) return null;
      const created = { id: `reward-${++seq}`, referrer_user_id: null, referred_credits: 0, referrer_credits: 0, referrer_rewarded_at: null, created_at: NOW.toISOString(), ...row } as ReferralRewardRow;
      rewards.push(created);
      return created;
    },
    pendingReferrerRewards: async (code: string) => rewards.filter((r) => r.code === code && !r.referrer_rewarded_at),
    markReferrerRewarded: async (id: string, userId: string, credits: number, at: Date) => {
      const r = rewards.find((x) => x.id === id && !x.referrer_rewarded_at);
      if (r) Object.assign(r, { referrer_user_id: userId, referrer_credits: credits, referrer_rewarded_at: at.toISOString() });
    },
    referrerRewardsSince: async (userId: string, since: Date) =>
      rewards.filter((r) => r.referrer_user_id === userId && r.referrer_rewarded_at && Date.parse(r.referrer_rewarded_at) >= since.getTime()).length,
    rewardsForCode: async (code: string) => rewards.filter((r) => r.code === code),
    grant: async (userId: string, amount: number, reason: string, sourceId: string) => {
      if (grants.some((g) => g.user_id === userId && g.reason === reason && g.source_id === sourceId)) return false;
      grants.push({ user_id: userId, amount, reason, source_id: sourceId });
      return true;
    },
    creditsEarned: async (userId: string, reasons: string[]) => grants.filter((g) => g.user_id === userId && reasons.includes(g.reason)).reduce((s, g) => s + g.amount, 0),
  };

  const service = new ReferralService(
    {
      referrals: repo,
      waitlist: {
        findByEmail: async (email: string) => entries.find((e) => e.email === email) ?? null,
        findById: async (id: string) => entries.find((e) => e.id === id) ?? null,
      },
      userIdByEmail: async (email: string) => users.get(email) ?? null,
      generate: () => {
        const code = `code${String(++seq).padStart(4, "0")}`;
        generated.push(code);
        return code;
      },
    } as never,
    config,
    createLogger(),
  );

  const signUp = async (id: string, email: string, ref: string | null) => {
    const e = entry(id, email);
    entries.push(e);
    return service.recordSignup(e, ref, true);
  };
  return { service, codes, entries, rewards, grants, users, signUp };
}

describe("referral codes", () => {
  it("generates readable codes and normalizes input", () => {
    const code = generateReferralCode();
    expect(code).toMatch(/^[a-z0-9]{8}$/);
    expect(normalizeReferralCode("  AbCd2345 ")).toBe("abcd2345");
    expect(normalizeReferralCode("bad code!")).toBeNull();
    expect(normalizeReferralCode(undefined)).toBeNull();
  });
});

describe("ReferralService", () => {
  it("gives every signup a code and credits signups made through it", async () => {
    const { signUp, service, entries } = setup();
    const aliceCode = await signUp("e1", "alice@example.com", null);
    expect(aliceCode).toMatch(/^code/);
    await signUp("e2", "bob@example.com", aliceCode.toUpperCase());
    await signUp("e3", "cara@example.com", aliceCode);
    await signUp("e4", "dan@example.com", aliceCode);
    expect(entries.find((e) => e.id === "e2")?.referred_by_code).toBe(aliceCode);
    expect(await service.publicStatus(aliceCode)).toEqual({ code: aliceCode, signups: 3, threshold: 3, priority: true });
    expect(await service.publicStatus("nonexistent1")).toBeNull();
  });

  it("ignores self-referrals, unknown codes, and repeat signups", async () => {
    const { signUp, service, entries } = setup();
    const aliceCode = await signUp("e1", "alice@example.com", null);
    // Same person signing up again through their own link.
    const again = entry("e1", "alice@example.com");
    await service.recordSignup(again, aliceCode, false);
    await signUp("e2", "bob@example.com", "doesnotexist");
    expect(entries.every((e) => e.referred_by_code === null)).toBe(true);
    expect(await service.publicStatus(aliceCode)).toMatchObject({ signups: 0 });
  });

  it("rewards both sides when a referred friend creates an account, only once", async () => {
    const { signUp, service, users, grants, rewards } = setup();
    const aliceCode = await signUp("e1", "alice@example.com", null);
    await signUp("e2", "bob@example.com", aliceCode);
    users.set("alice@example.com", "alice-user");
    await service.onAccountCreated("alice-user", "alice@example.com", NOW);

    users.set("bob@example.com", "bob-user");
    await service.onAccountCreated("bob-user", "bob@example.com", NOW);
    await service.onAccountCreated("bob-user", "bob@example.com", NOW); // repeat sign-in

    expect(grants).toEqual([
      { user_id: "bob-user", amount: 50, reason: REFERRED_REASON, source_id: rewards[0]!.id },
      { user_id: "alice-user", amount: 25, reason: REFERRER_REASON, source_id: rewards[0]!.id },
      { user_id: "alice-user", amount: 75, reason: MILESTONE_REASON, source_id: `${aliceCode}:1` },
    ]);
    expect(rewards).toHaveLength(1);
    // Bob's account keeps Bob's own waitlist code.
    expect(await service.summary("bob-user", "bob@example.com")).toMatchObject({ code: expect.stringMatching(/^code/), signups: 0 });
    expect(await service.summary("alice-user", "alice@example.com")).toMatchObject({
      code: aliceCode,
      signups: 1,
      accounts: 1,
      creditsEarned: 100,
      pendingRewards: 0,
      next: { at: 3, credits: 100, remaining: 2 },
    });
  });

  it("holds the referrer's reward until they have an account", async () => {
    const { signUp, service, users, grants } = setup();
    const aliceCode = await signUp("e1", "alice@example.com", null);
    await signUp("e2", "bob@example.com", aliceCode);

    users.set("bob@example.com", "bob-user");
    await service.onAccountCreated("bob-user", "bob@example.com", NOW);
    expect(grants.map((g) => g.user_id)).toEqual(["bob-user"]);

    users.set("alice@example.com", "alice-user");
    await service.onAccountCreated("alice-user", "alice@example.com", NOW);
    expect(grants.map((g) => [g.user_id, g.amount])).toEqual([
      ["bob-user", 50],
      ["alice-user", 25],
      ["alice-user", 75],
    ]);
  });

  it("pays a milestone bonus once, when the friend count lands on it", async () => {
    const { signUp, service, users, grants } = setup();
    const aliceCode = await signUp("e1", "alice@example.com", null);
    users.set("alice@example.com", "alice-user");
    await service.onAccountCreated("alice-user", "alice@example.com", NOW);
    for (const name of ["bob", "cara", "dan"]) {
      await signUp(`e-${name}`, `${name}@example.com`, aliceCode);
      users.set(`${name}@example.com`, `${name}-user`);
      await service.onAccountCreated(`${name}-user`, `${name}@example.com`, NOW);
      await service.onAccountCreated(`${name}-user`, `${name}@example.com`, NOW); // signing in again pays nothing extra
    }
    const alice = grants.filter((g) => g.user_id === "alice-user");
    expect(alice.filter((g) => g.reason === REFERRER_REASON)).toHaveLength(3);
    expect(alice.filter((g) => g.reason === MILESTONE_REASON)).toEqual([
      { user_id: "alice-user", amount: 75, reason: MILESTONE_REASON, source_id: `${aliceCode}:1` },
      { user_id: "alice-user", amount: 100, reason: MILESTONE_REASON, source_id: `${aliceCode}:3` },
    ]);
    // 3 x 25 per friend + 75 + 100 milestones.
    expect(alice.reduce((sum, g) => sum + g.amount, 0)).toBe(250);
    // The last milestone repeats, so there is always a next goal.
    expect(await service.summary("alice-user", "alice@example.com")).toMatchObject({ accounts: 3, next: { at: 6, credits: 100, remaining: 3 } });
  });

  it("caps referrer rewards per month", async () => {
    const { signUp, service, users, grants } = setup({ referrerCredits: 25, referredCredits: 50, priorityThreshold: 3, maxRewardsPerMonth: 1, milestones: MILESTONES });
    const aliceCode = await signUp("e1", "alice@example.com", null);
    users.set("alice@example.com", "alice-user");
    await service.onAccountCreated("alice-user", "alice@example.com", NOW);
    for (const name of ["bob", "cara"]) {
      await signUp(`e-${name}`, `${name}@example.com`, aliceCode);
      users.set(`${name}@example.com`, `${name}-user`);
      await service.onAccountCreated(`${name}-user`, `${name}@example.com`, NOW);
    }
    expect(grants.filter((g) => g.user_id === "alice-user" && g.reason === REFERRER_REASON)).toHaveLength(1);
    // The friends still get their welcome credits.
    expect(grants.filter((g) => g.reason === REFERRED_REASON)).toHaveLength(2);
  });

  it("gives accounts without a waitlist signup their own code", async () => {
    const { service, codes } = setup();
    const code = await service.codeForUser("admin-made", "new@example.com");
    expect(codes).toEqual([expect.objectContaining({ code, user_id: "admin-made", waitlist_entry_id: null })]);
    expect(await service.codeForUser("admin-made", "new@example.com")).toBe(code);
  });
});
