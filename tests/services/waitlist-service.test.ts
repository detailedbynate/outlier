import { describe, expect, it, vi } from "vitest";
import { safeEqual } from "@/lib/api/auth";
import { createLogger } from "@/lib/core/logger";
import type { WaitlistRepository } from "@/lib/database/repositories/waitlist";
import { WaitlistService, type InviteSender } from "@/lib/services/waitlist-service";
import type { WaitlistEntryRow } from "@/types/database";

function entry(overrides: Partial<WaitlistEntryRow> = {}): WaitlistEntryRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: "creator@example.com",
    name: null,
    channel_url: null,
    niche: null,
    use_case: null,
    source: null,
    status: "pending",
    invited_at: null,
    joined_at: null,
    invited_by: null,
    created_at: "2026-09-14T00:00:00Z",
    updated_at: "2026-09-14T00:00:00Z",
    ...overrides,
  };
}

function setup(existing: WaitlistEntryRow | null = null) {
  const repository = {
    insert: vi.fn(async (row: Partial<WaitlistEntryRow>) => (existing ? null : entry(row))),
    findByEmail: vi.fn(async () => existing),
    findById: vi.fn(async () => existing ?? entry()),
    positionOf: vi.fn(async () => 42),
    update: vi.fn(async () => {}),
  };
  const invites: InviteSender = {
    inviteByEmail: vi.fn(async () => {}),
    createSignInLink: vi.fn(async () => "https://outlier.app/auth/confirm?token_hash=abc&type=invite"),
  };
  const service = new WaitlistService(repository as unknown as WaitlistRepository, invites, createLogger());
  return { service, repository, invites };
}

describe("WaitlistService.join", () => {
  it("normalizes input and returns the signup position", async () => {
    const { service, repository } = setup();
    const result = await service.join({ email: "  Creator@Example.COM ", niche: " cooking ", channelUrl: "" });
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ email: "creator@example.com", niche: "cooking", channel_url: null }),
    );
    expect(result).toMatchObject({ position: 42, alreadyJoined: false });
  });

  it("treats a repeat signup as success with the existing spot", async () => {
    const { service } = setup(entry());
    await expect(service.join({ email: "creator@example.com" })).resolves.toMatchObject({ alreadyJoined: true, position: 42 });
  });

  it("rejects invalid emails and overly long fields", async () => {
    const { service, repository } = setup();
    await expect(service.join({ email: "nope" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(service.join({ email: "a@b.co", useCase: "x".repeat(501) })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(repository.insert).not.toHaveBeenCalled();
  });
});

describe("WaitlistService invites", () => {
  it("emails an invite to /auth/confirm and marks the entry invited", async () => {
    const { service, invites, repository } = setup();
    await service.invite(entry().id, "https://outlier.app/", "admin-1");
    expect(invites.inviteByEmail).toHaveBeenCalledWith("creator@example.com", "https://outlier.app/auth/confirm");
    expect(repository.update).toHaveBeenCalledWith(entry().id, expect.objectContaining({ status: "invited", invited_by: "admin-1" }));
  });

  it("only counts invited or joined entries as approved", async () => {
    expect(await setup(entry({ status: "pending" })).service.isInvited("creator@example.com")).toBe(false);
    expect(await setup(entry({ status: "invited" })).service.isInvited("creator@example.com")).toBe(true);
    expect(await setup(null).service.isInvited("stranger@example.com")).toBe(false);
  });

  it("does not re-stamp entries that already joined", async () => {
    const { service, repository } = setup(entry({ status: "joined" }));
    await service.markJoined("creator@example.com");
    expect(repository.update).not.toHaveBeenCalled();
  });
});

describe("safeEqual", () => {
  it("compares strings in constant time without Node APIs", () => {
    expect(safeEqual("secret-token", "secret-token")).toBe(true);
    expect(safeEqual("secret-token", "secret-tokeN")).toBe(false);
    expect(safeEqual("short", "longer-value")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});
