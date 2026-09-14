import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/lib/core/logger";
import { moderationState, PERMANENT_UNTIL } from "@/lib/moderation/status";
import { ModerationService } from "@/lib/services/moderation-service";
import type { AccountSettingsRow, WaitlistEntryRow } from "@/types/database";

const NOW = new Date("2026-09-18T12:00:00Z");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OWNER = id(1);
const ADMIN = id(2);
const MEMBER = id(3);
const OTHER = id(4);

const settings = (userId: string, patch: Partial<AccountSettingsRow> = {}): AccountSettingsRow => ({
  user_id: userId,
  email: `${userId.slice(-1)}@example.com`,
  role: "member",
  daily_credits: null,
  youtube_daily_units: null,
  quota_tier: "default",
  disabled: false,
  note: null,
  created_by: null,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  banned_until: null,
  ban_reason: null,
  restricted_until: null,
  restrict_reason: null,
  ...patch,
});

describe("moderationState", () => {
  it("derives banned, suspended, restricted, and expired states", () => {
    expect(moderationState(settings(MEMBER, { banned_until: PERMANENT_UNTIL, ban_reason: "spam" }), NOW)).toEqual({ status: "banned", until: null, reason: "spam", permanent: true });
    expect(moderationState(settings(MEMBER, { banned_until: "2026-09-19T12:00:00Z" }), NOW)).toMatchObject({ status: "suspended", until: "2026-09-19T12:00:00Z" });
    expect(moderationState(settings(MEMBER, { restricted_until: "2026-09-20T00:00:00Z" }), NOW).status).toBe("restricted");
    expect(moderationState(settings(MEMBER, { banned_until: "2026-09-17T00:00:00Z", restricted_until: "2026-09-17T00:00:00Z" }), NOW).status).toBe("active");
    expect(moderationState(settings(MEMBER, { disabled: true }), NOW).status).toBe("banned");
    expect(moderationState(null, NOW).status).toBe("active");
  });
});

function setup() {
  const rows = new Map<string, AccountSettingsRow>([
    [OWNER, settings(OWNER, { role: "owner", email: "founder@example.com" })],
    [ADMIN, settings(ADMIN, { role: "admin", email: "admin@example.com" })],
    [MEMBER, settings(MEMBER, { email: "member@example.com" })],
  ]);
  const users = [
    { id: OWNER, email: "founder@example.com", created_at: "2026-09-01T00:00:00Z" },
    { id: ADMIN, email: "admin@example.com", created_at: "2026-09-01T00:00:00Z" },
    { id: MEMBER, email: "member@example.com", created_at: "2026-09-01T00:00:00Z" },
    // Joined from the waitlist, no settings row yet.
    { id: OTHER, email: "other@example.com", created_at: "2026-09-02T00:00:00Z" },
  ];
  const entries: WaitlistEntryRow[] = [id(10), id(11)].map((entryId, i) => ({
    id: entryId,
    email: `w${i}@example.com`,
    name: null,
    channel_url: null,
    niche: null,
    use_case: null,
    source: null,
    status: "pending",
    invited_at: null,
    joined_at: null,
    invited_by: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  }));
  const deps = {
    moderation: {
      log: vi.fn(async () => {}),
      recent: vi.fn(async () => []),
      listUsers: vi.fn(async () => users.map((u) => ({ ...u, settings: rows.get(u.id) ?? null }))),
      deleteUser: vi.fn(async () => true),
    },
    accounts: {
      findByUserId: vi.fn(async (userId: string) => rows.get(userId) ?? null),
      upsert: vi.fn(async (row: Partial<AccountSettingsRow> & { user_id: string; email: string }) => {
        const saved = settings(row.user_id, row);
        rows.set(row.user_id, saved);
        return saved;
      }),
      update: vi.fn(async (userId: string, patch: Partial<AccountSettingsRow>) => {
        const saved = { ...rows.get(userId)!, ...patch };
        rows.set(userId, saved);
        return saved;
      }),
    },
    waitlist: {
      findByIds: vi.fn(async (ids: string[]) => entries.filter((e) => ids.includes(e.id))),
      deleteMany: vi.fn(async () => {}),
      updateMany: vi.fn(async () => {}),
    },
    auth: { setBan: vi.fn(async () => {}) },
    onAccountChanged: vi.fn(),
    isOwnerEmail: (email: string) => email === "founder@example.com",
  };
  return { deps, rows, service: new ModerationService(deps, createLogger()) };
}

const owner = { userId: OWNER, role: "owner" as const };
const admin = { userId: ADMIN, role: "admin" as const };

describe("ModerationService.moderateAccounts", () => {
  it("suspends many accounts at once, creating settings rows as needed, and logs it", async () => {
    const { service, deps, rows } = setup();
    const result = await service.moderateAccounts({ action: "temp_ban", userIds: [MEMBER, OTHER], durationHours: "24", reason: "spam" }, owner, NOW);
    expect(result).toEqual({ applied: 2, skipped: [] });
    expect(rows.get(MEMBER)).toMatchObject({ banned_until: "2026-09-19T12:00:00.000Z", ban_reason: "spam" });
    expect(rows.get(OTHER)).toMatchObject({ email: "other@example.com", banned_until: "2026-09-19T12:00:00.000Z" });
    expect(deps.auth.setBan).toHaveBeenCalledWith(MEMBER, 24);
    expect(deps.moderation.log).toHaveBeenCalledWith([
      expect.objectContaining({ target_email: "member@example.com", action: "temp_ban", until: "2026-09-19T12:00:00.000Z", actor_id: OWNER }),
      expect.objectContaining({ target_email: "other@example.com" }),
    ]);
    expect(deps.onAccountChanged).toHaveBeenCalledWith(MEMBER);
  });

  it("skips the owner, yourself, and (for admins) other admins", async () => {
    const { service } = setup();
    const result = await service.moderateAccounts({ action: "ban", userIds: [OWNER, ADMIN, MEMBER] }, admin, NOW);
    expect(result.applied).toBe(1);
    expect(result.skipped.map((s) => s.reason)).toEqual(["The owner account can't be moderated", "You can't moderate your own account"]);
    const byOwner = await service.moderateAccounts({ action: "restrict", userIds: [ADMIN] }, owner, NOW);
    expect(byOwner.applied).toBe(1);
  });

  it("restricts, lifts, sets limits, and removes accounts", async () => {
    const { service, deps, rows } = setup();
    await service.moderateAccounts({ action: "restrict", userIds: [MEMBER], durationHours: "0" }, owner, NOW);
    expect(rows.get(MEMBER)?.restricted_until).toBe(PERMANENT_UNTIL);
    await service.moderateAccounts({ action: "unrestrict", userIds: [MEMBER] }, owner, NOW);
    expect(rows.get(MEMBER)?.restricted_until).toBeNull();
    await service.moderateAccounts({ action: "set_limits", userIds: [MEMBER], dailyCredits: "25", youtubeDailyUnits: "" }, owner, NOW);
    expect(rows.get(MEMBER)).toMatchObject({ daily_credits: 25, youtube_daily_units: null });

    await service.moderateAccounts({ action: "remove", userIds: [MEMBER], reason: "requested" }, owner, NOW);
    expect(deps.moderation.deleteUser).toHaveBeenCalledWith(MEMBER);
    expect(deps.moderation.log).toHaveBeenLastCalledWith([expect.objectContaining({ action: "remove", target_user_id: null, target_email: "member@example.com" })]);
  });

  it("requires a duration for suspensions and rejects non-admins", async () => {
    const { service } = setup();
    await expect(service.moderateAccounts({ action: "temp_ban", userIds: [MEMBER] }, owner, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(service.moderateAccounts({ action: "ban", userIds: [MEMBER] }, { userId: OTHER, role: "member" }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps the app-level ban when the auth ban call fails", async () => {
    const { service, deps, rows } = setup();
    deps.auth.setBan.mockRejectedValueOnce(new Error("auth down"));
    expect((await service.moderateAccounts({ action: "ban", userIds: [MEMBER] }, owner, NOW)).applied).toBe(1);
    expect(rows.get(MEMBER)?.banned_until).toBe(PERMANENT_UNTIL);
  });
});

describe("ModerationService.moderateWaitlist", () => {
  it("removes, declines, and restores entries in bulk", async () => {
    const { service, deps } = setup();
    expect(await service.moderateWaitlist("remove", [id(10), id(11), "not-a-uuid"], owner)).toEqual({ applied: 2, skipped: [] });
    expect(deps.waitlist.deleteMany).toHaveBeenCalledWith([id(10), id(11)]);
    await service.moderateWaitlist("decline", [id(10)], admin);
    expect(deps.waitlist.updateMany).toHaveBeenCalledWith([id(10)], { status: "declined" });
    await service.moderateWaitlist("restore", [id(11)], admin);
    expect(deps.waitlist.updateMany).toHaveBeenLastCalledWith([id(11)], { status: "pending", invited_at: null, invited_by: null });
    await expect(service.moderateWaitlist("remove", [], owner)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});