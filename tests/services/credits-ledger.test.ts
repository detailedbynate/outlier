import { describe, expect, it, vi } from "vitest";
import { CreditsService } from "@/lib/services/credits-service";

const NOW = new Date("2026-09-13T20:30:00Z");

/** A month where `spent` credits went through usage events and the ledger holds `rows`. */
function setup(options: { spent?: number; rows?: { amount: number; kind: "purchase" | "admin" | "spend" }[]; allowance?: number | null } = {}) {
  let spent = options.spent ?? 0;
  const rows = [...(options.rows ?? [])];
  const usage = {
    creditsSpentSince: vi.fn(async () => spent),
    hasEventSince: vi.fn(async () => false),
    record: vi.fn(async (event: { credits_cost?: number }) => {
      spent += event.credits_cost ?? 0;
      return {} as never;
    }),
  };
  const ledger = {
    balance: vi.fn(async () => rows.reduce((sum, r) => sum + r.amount, 0)),
    spentSince: vi.fn(async () => rows.filter((r) => r.kind === "spend").reduce((sum, r) => sum - r.amount, 0)),
    add: vi.fn(async (row: { amount: number; kind: "purchase" | "admin" | "spend"; stripe_session_id?: string | null }) => {
      if (row.stripe_session_id && ledger.add.mock.calls.filter(([r]) => r.stripe_session_id === row.stripe_session_id).length > 1) return null;
      rows.push({ amount: row.amount, kind: row.kind });
      return row as never;
    }),
  };
  const service = new CreditsService(usage, 100, async () => options.allowance ?? null, undefined, ledger);
  return { service, usage, ledger, rows };
}

describe("CreditsService (extra credits)", () => {
  it("adds extra credits on top of the monthly allowance", async () => {
    const { service } = setup({ spent: 40, rows: [{ amount: 200, kind: "purchase" }] });
    expect(await service.status("u1", NOW)).toMatchObject({ used: 40, monthly: 100, extra: 200, limit: 300, remaining: 260 });
  });

  it("spends the monthly allowance first, then draws down extra credits", async () => {
    const { service, ledger } = setup({ spent: 96, rows: [{ amount: 50, kind: "purchase" }] });
    // 4 monthly credits left, so a 10-credit search takes 6 from the extras.
    await service.charge("u1", "discover_channels", undefined, NOW);
    expect(ledger.add).toHaveBeenCalledWith(expect.objectContaining({ amount: -6, kind: "spend" }));
    expect(await service.status("u1", NOW)).toMatchObject({ used: 100, extra: 44, remaining: 44 });

    // Monthly is used up now, so everything comes from the extras.
    await service.charge("u1", "analyze_video", undefined, NOW);
    expect(await service.status("u1", NOW)).toMatchObject({ used: 100, extra: 42, remaining: 42 });
  });

  it("doesn't touch extra credits while the monthly allowance covers the cost", async () => {
    const { service, ledger } = setup({ spent: 10, rows: [{ amount: 50, kind: "purchase" }] });
    await service.charge("u1", "discover_channels", undefined, NOW);
    expect(ledger.add).not.toHaveBeenCalled();
  });

  it("lets the owner add and remove extra credits, but not below zero", async () => {
    const { service, ledger } = setup({ rows: [{ amount: 30, kind: "purchase" }] });
    expect(await service.adjust("u1", 100, "comp for outage", "owner")).toEqual({ extra: 130 });
    expect(ledger.add).toHaveBeenLastCalledWith(expect.objectContaining({ amount: 100, kind: "admin", note: "comp for outage", actor_id: "owner" }));
    expect(await service.adjust("u1", -130, null, "owner")).toEqual({ extra: 0 });
    await expect(service.adjust("u1", -1, null, "owner")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(service.adjust("u1", 0, null, "owner")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(service.adjust("u1", 1.5, null, "owner")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("counts a Stripe purchase once, however many times it's fulfilled", async () => {
    const { service } = setup();
    expect(await service.addPurchase("u1", 600, "cs_test_1", "600 credits")).toBe(true);
    expect(await service.addPurchase("u1", 600, "cs_test_1", "600 credits")).toBe(false);
    expect(await service.status("u1", NOW)).toMatchObject({ extra: 600 });
  });

  it("restricted accounts can't spend extra credits", async () => {
    const { service } = setup({ allowance: 0, rows: [{ amount: 500, kind: "purchase" }] });
    expect(await service.status("u1", NOW)).toMatchObject({ limit: 0, remaining: 0, extra: 0 });
  });
});
