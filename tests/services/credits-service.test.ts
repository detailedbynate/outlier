import { describe, expect, it, vi } from "vitest";
import { CreditsService, startOfUtcDay } from "@/lib/services/credits-service";

const NOW = new Date("2026-09-13T20:30:00Z");

function setup(spent: number, paidResources: string[] = []) {
  const usage = {
    creditsSpentSince: vi.fn(async () => spent),
    hasEventSince: vi.fn(async (_u: string, _t: string, resourceId: string) => paidResources.includes(resourceId)),
    record: vi.fn(async () => ({}) as never),
  };
  return { usage, service: new CreditsService(usage, 100) };
}

describe("CreditsService", () => {
  it("reports today's usage and the next UTC reset", async () => {
    const { service, usage } = setup(37);
    expect(await service.status("u1", NOW)).toEqual({ used: 37, limit: 100, remaining: 63, resetsAt: "2026-09-14T00:00:00.000Z" });
    expect(usage.creditsSpentSince).toHaveBeenCalledWith("u1", startOfUtcDay(NOW));
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

describe("CreditsService per-user limits", () => {
  it("uses an account's daily credit override when set", async () => {
    const usage = { creditsSpentSince: vi.fn(async () => 40), hasEventSince: vi.fn(async () => false), record: vi.fn(async () => ({}) as never) };
    const service = new CreditsService(usage, 100, async (userId) => (userId === "vip" ? 500 : null));
    expect((await service.status("vip", NOW)).limit).toBe(500);
    expect((await service.status("regular", NOW)).remaining).toBe(60);
  });
});