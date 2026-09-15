import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/lib/core/logger";
import { AccountService, OWNER_MONTHLY_CREDITS } from "@/lib/services/account-service";
import type { AccountSettingsRow } from "@/types/database";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";

function setup() {
  const rows = new Map<string, AccountSettingsRow>();
  const base = (row: Partial<AccountSettingsRow> & Pick<AccountSettingsRow, "user_id" | "email">): AccountSettingsRow => ({
    role: "member",
    daily_credits: null,
    youtube_daily_units: null,
    quota_tier: "default",
    disabled: false,
    note: null,
    created_by: null,
    created_at: "2026-09-17T00:00:00Z",
    updated_at: "2026-09-17T00:00:00Z",
    banned_until: null,
    ban_reason: null,
    restricted_until: null,
    restrict_reason: null,
    ...row,
  });
  const repository = {
    findByUserId: vi.fn(async (id: string) => rows.get(id) ?? null),
    list: vi.fn(async () => [...rows.values()]),
    upsert: vi.fn(async (row: Partial<AccountSettingsRow> & Pick<AccountSettingsRow, "user_id" | "email">) => {
      const saved = base({ ...rows.get(row.user_id), ...row });
      rows.set(row.user_id, saved);
      return saved;
    }),
    update: vi.fn(async (id: string, patch: Partial<AccountSettingsRow>) => {
      const saved = { ...rows.get(id)!, ...patch };
      rows.set(id, saved);
      return saved;
    }),
    userIdByEmail: vi.fn(async () => null),
  };
  let next = 10;
  const provisioner = {
    provision: vi.fn(async () => ({ userId: `00000000-0000-4000-8000-0000000000${next++}`, link: "https://app/auth/confirm?token_hash=x&type=invite", existed: false })),
  };
  const service = new AccountService({ repository, provisioner }, { ownerEmails: ["Founder@Example.com"] }, createLogger());
  return { service, repository, provisioner, rows };
}

const owner = { userId: OWNER_ID, role: "owner" as const };

describe("AccountService", () => {
  it("makes the owner email the owner on sign-in, with unlimited limits", async () => {
    const { service, rows } = setup();
    const row = await service.forUser(OWNER_ID, "founder@example.com");
    expect(row).toMatchObject({ role: "owner", email: "founder@example.com" });
    expect(rows.get(OWNER_ID)?.role).toBe("owner");
    expect(await service.limitsFor(OWNER_ID)).toMatchObject({ role: "owner", monthlyCredits: OWNER_MONTHLY_CREDITS, youtubeDailyUnits: null });
  });

  it("creates accounts with custom limits and returns a sign-in link", async () => {
    const { service, provisioner } = setup();
    const { account, link } = await service.create({ email: " Pal@Example.com ", role: "member", monthlyCredits: "250", youtubeDailyUnits: "", delivery: "link" }, owner, "https://app/auth/confirm");
    expect(provisioner.provision).toHaveBeenCalledWith("pal@example.com", "https://app/auth/confirm", "link");
    expect(account).toMatchObject({ email: "pal@example.com", role: "member", daily_credits: 250, youtube_daily_units: null, created_by: OWNER_ID });
    expect(link).toContain("token_hash");
    expect(await service.limitsFor(account.user_id)).toMatchObject({ monthlyCredits: 250, youtubeDailyUnits: undefined });
  });

  it("only lets the owner create or manage admins, and protects the owner account", async () => {
    const { service } = setup();
    await service.forUser(OWNER_ID, "founder@example.com");
    const admin = { userId: "00000000-0000-4000-8000-000000000099", role: "admin" as const };
    await expect(service.create({ email: "a@example.com", role: "admin" }, admin, "https://app")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.create({ email: "founder@example.com" }, owner, "https://app")).rejects.toMatchObject({ code: "CONFLICT" });

    const { account } = await service.create({ email: "helper@example.com", role: "admin" }, owner, "https://app");
    await expect(service.update(account.user_id, { monthlyCredits: "5" }, admin)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.update(OWNER_ID, { disabled: true }, owner)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.update(OWNER_ID, { role: "member" }, owner)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets admins update members, including disabling them", async () => {
    const { service } = setup();
    const { account } = await service.create({ email: "m@example.com" }, owner, "https://app");
    const admin = { userId: "00000000-0000-4000-8000-000000000099", role: "admin" as const };
    const updated = await service.update(account.user_id, { monthlyCredits: "20", youtubeDailyUnits: "300", disabled: true }, admin);
    expect(updated).toMatchObject({ daily_credits: 20, youtube_daily_units: 300, disabled: true });
    await expect(service.update(account.user_id, { role: "admin" }, admin)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("gives restricted or suspended accounts nothing to spend", async () => {
    const { service, repository } = setup();
    const { account } = await service.create({ email: "r@example.com", monthlyCredits: "500" }, owner, "https://app");
    await repository.update(account.user_id, { restricted_until: "9999-12-31T00:00:00.000Z" });
    service.invalidate(account.user_id);
    expect(await service.limitsFor(account.user_id)).toMatchObject({ monthlyCredits: 0, youtubeDailyUnits: 0, disabled: false });
  });

  it("creates a settings row when editing someone who joined from the waitlist", async () => {
    const { service } = setup();
    const userId = "00000000-0000-4000-8000-000000000077";
    const updated = await service.update(userId, { monthlyCredits: "40", email: "joined@example.com" }, owner);
    expect(updated).toMatchObject({ user_id: userId, email: "joined@example.com", daily_credits: 40 });
  });

  it("returns defaults instead of failing when settings can't be read", async () => {
    const { service, repository } = setup();
    repository.findByUserId.mockRejectedValueOnce(new Error("relation does not exist"));
    expect(await service.forUser("00000000-0000-4000-8000-000000000050", "x@example.com")).toBeNull();
  });
});