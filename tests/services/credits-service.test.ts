import { describe, expect, it, vi } from "vitest";
import { CreditsService, startOfUtcMonth } from "@/lib/services/credits-service";

const NOW = new Date("2026-09-13T20:30:00Z");

function setup(spent: number, paidResources: string[] = []) {
  const usage = {
    creditsSpentSince: vi.fn(async () => spent),
    hasEventSince: vi.fn(async (_u: string, _t: string, resourceId: string) => paidResources.includes(resourceId)),
    record: vi.fn(async () => ({}) as never),
  };
  return { usage, service: new CreditsService(usage, 100) };
}

describe("CreditsService (monthly)", () => {
  it("reports this month's usage and the next monthly reset", async () => {
    const { service, usage } = setup(37);
    expect(await service.status("u1", NOW)).toEqual({ used: 37, limit: 100, remaining: 63, bonus: 0, resetsAt: "2026-10-01T00:00:00.000Z" });
    expect(usage.creditsSpentSince).toHaveBeenCalledWith("u1", startOfUtcMonth(NOW));
  });

  it("rolls over the year in December", async () => {
    expect((await setup(0).service.status("u1", new Date("2026-12-31T23:00:00Z"))).resetsAt).toBe("2027-01-01T00:00:00.000Z");
  });

  it("blocks actions the user can't afford", async () => {
    await expect(setup(95).service.assertAvailable("u1", "discover_channels", NOW)).rejects.toMatchObject({
      code: "INSUFFICIENT_CREDITS",
      status: 402,
    });
    await expect(setup(98).service.assertAvailable("u1", "analyze_video", NOW)).resolves.toMatchObject({ remaining: 2 });
  });

  it("records the cost, and repeats on the same resource are free", async () => {
    const { service, usage } = setup(0, ["dQw4w9WgXcQ"]);
    expect(await service.charge("u1", "analyze_video", "dQw4w9WgXcQ", NOW)).toEqual({ charged: 0 });
    expect(usage.record).not.toHaveBeenCalled();

    expect(await service.charge("u1", "analyze_video", "abcdefghijk", NOW)).toEqual({ charged: 2 });
    expect(usage.record).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "credits.analyze_video", user_id: "u1", credits_cost: 2, resource_id: "abcdefghijk" }),
    );
  });
});

describe("CreditsService per-user limits and bonus credits", () => {
  const usage = () => ({ creditsSpentSince: vi.fn(async () => 40), hasEventSince: vi.fn(async () => false), record: vi.fn(async () => ({}) as never) });

  it("uses an account's monthly allowance override when set", async () => {
    const service = new CreditsService(usage(), 100, async (userId) => (userId === "vip" ? 500 : null));
    expect((await service.status("vip", NOW)).limit).toBe(500);
    expect((await service.status("regular", NOW)).remaining).toBe(60);
  });

  it("adds bonus credits granted this month, but not for restricted accounts", async () => {
    const bonusSince = vi.fn(async () => 50);
    const service = new CreditsService(usage(), 100, async (userId) => (userId === "restricted" ? 0 : null), bonusSince);
    expect(await service.status("u1", NOW)).toMatchObject({ limit: 150, remaining: 110, bonus: 50 });
    expect(bonusSince).toHaveBeenCalledWith("u1", startOfUtcMonth(NOW));
    expect(await service.status("restricted", NOW)).toMatchObject({ limit: 0, remaining: 0, bonus: 0 });
  });
});
