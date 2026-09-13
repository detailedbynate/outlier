import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/lib/core/logger";
import { JobScheduler } from "@/lib/jobs/scheduler";
import { StorageBudgetService } from "@/lib/services/storage-budget-service";
import type { JobRow } from "@/types/database";

const MB = 1024 * 1024;
const silent = createLogger();

describe("StorageBudgetService", () => {
  const service = (usedMb: number) =>
    new StorageBudgetService(async () => usedMb * MB, { budgetMb: 250, planLimitMb: 500 }, silent, 0);

  it("reports levels against the budget, not the plan limit", async () => {
    expect((await service(100).getStatus()).level).toBe("ok");
    expect((await service(210).getStatus()).level).toBe("warning");
    const over = await service(260).getStatus();
    expect(over.level).toBe("over_budget");
    expect(over.planUsed).toBeCloseTo(0.52);
  });

  it("blocks ingestion once over budget", async () => {
    await expect(service(100).assertCapacity()).resolves.toMatchObject({ level: "ok" });
    await expect(service(250).assertCapacity()).rejects.toMatchObject({ code: "STORAGE_BUDGET_EXCEEDED", status: 507 });
  });

  it("rejects a budget above the plan limit", () => {
    expect(() => new StorageBudgetService(async () => 0, { budgetMb: 600, planLimitMb: 500 }, silent)).toThrow(/must not exceed/);
  });

  it("caches measurements", async () => {
    const measure = vi.fn(async () => 10 * MB);
    const cached = new StorageBudgetService(measure, { budgetMb: 250, planLimitMb: 500 }, silent, 60_000);
    await cached.getStatus();
    await cached.getStatus();
    expect(measure).toHaveBeenCalledTimes(1);
    await cached.getStatus({ fresh: true });
    expect(measure).toHaveBeenCalledTimes(2);
  });
});

describe("JobScheduler", () => {
  const now = new Date("2026-09-13T12:00:00Z");
  const jobCreated = (iso: string) => ({ created_at: iso }) as JobRow;

  it("enqueues schedules that never ran or whose interval elapsed", async () => {
    const latest: Record<string, JobRow | null> = {
      "catalog.refresh": jobCreated("2026-09-12T11:00:00Z"), // 25h ago -> due
      "maintenance.prune_snapshots": jobCreated("2026-09-13T06:00:00Z"), // 6h ago -> not due
      "never.ran": null,
    };
    const enqueue = vi.fn(async () => ({}));
    const scheduler = new JobScheduler(
      { findLatestByType: async (type) => latest[type] ?? null, enqueue },
      [
        { type: "catalog.refresh", everyHours: 24 },
        { type: "maintenance.prune_snapshots", everyHours: 24 },
        { type: "never.ran", everyHours: 24 },
      ],
      silent,
    );

    expect(await scheduler.tick(now)).toEqual(["catalog.refresh", "never.ran"]);
    expect(enqueue).toHaveBeenCalledWith("catalog.refresh", {}, { idempotencyKey: "schedule:catalog.refresh" });
  });

  it("keeps going when one schedule fails", async () => {
    const enqueue = vi.fn(async (type: string) => {
      if (type === "a.fail") throw new Error("db down");
      return {};
    });
    const scheduler = new JobScheduler(
      { findLatestByType: async () => null, enqueue },
      [
        { type: "a.fail", everyHours: 1 },
        { type: "b.ok", everyHours: 1 },
      ],
      silent,
    );
    expect(await scheduler.tick(now)).toEqual(["b.ok"]);
  });
});
