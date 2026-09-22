import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError, ValidationError } from "@/lib/core/errors";
import { createLogger } from "@/lib/core/logger";
import type { JobRepository } from "@/lib/database/repositories/jobs";
import { retryDelayMs } from "@/lib/jobs/backoff";
import { JobQueue } from "@/lib/jobs/queue";
import { JobRegistry } from "@/lib/jobs/registry";
import { defineJob } from "@/lib/jobs/types";
import { JobWorker } from "@/lib/jobs/worker";
import { currentQuotaContext } from "@/lib/youtube/quota-context";
import { QuotaUnavailableError } from "@/lib/youtube/quota-manager";
import type { JobRow } from "@/types/database";

function job(overrides: Partial<JobRow> = {}): JobRow {
  const now = new Date().toISOString();
  return {
    id: "00000000-0000-4000-8000-000000000001",
    workspace_id: null,
    created_by: null,
    type: "test.echo",
    status: "running",
    payload: { message: "hi" },
    priority: 0,
    attempts: 1,
    max_attempts: 3,
    run_at: now,
    locked_at: now,
    locked_by: "w1",
    last_error: null,
    idempotency_key: null,
    started_at: now,
    finished_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function fakeRepository() {
  return {
    insert: vi.fn(async (row: Partial<JobRow>) => job({ ...row, status: "queued", attempts: 0 })),
    findActiveByIdempotencyKey: vi.fn(async (): Promise<JobRow | null> => null),
    addResult: vi.fn(async () => ({})),
    markSucceeded: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    claim: vi.fn(async (): Promise<JobRow[]> => []),
    requeueStale: vi.fn(async () => 0),
  };
}

function registryWith(handler: (payload: { message: string }) => Promise<unknown>) {
  return new JobRegistry().register(
    defineJob({
      type: "test.echo",
      description: "echo",
      payloadSchema: z.object({ message: z.string() }),
      handler: async (payload) => (await handler(payload)) as never,
    }),
  );
}

const silent = createLogger();

describe("JobRegistry", () => {
  it("rejects malformed and duplicate job types", () => {
    const registry = registryWith(async () => null);
    expect(() => registry.register({ ...registry.require("test.echo") })).toThrow(/registered twice/);
    expect(() => registry.register({ ...registry.require("test.echo"), type: "Bad Type" })).toThrow(/Invalid job type/);
  });

  it("validates payloads", () => {
    const registry = registryWith(async () => null);
    expect(registry.parsePayload("test.echo", { message: "x" })).toEqual({ message: "x" });
    expect(() => registry.parsePayload("test.echo", { message: 1 })).toThrow(ValidationError);
    expect(() => registry.parsePayload("nope.nope", {})).toThrow(/Unknown job type/);
  });
});

describe("JobQueue", () => {
  it("validates before inserting and applies definition defaults", async () => {
    const repo = fakeRepository();
    const queue = new JobQueue(repo as unknown as JobRepository, registryWith(async () => null));
    await expect(queue.enqueue("test.echo", { message: 5 })).rejects.toThrow(ValidationError);
    expect(repo.insert).not.toHaveBeenCalled();

    const { created } = await queue.enqueue("test.echo", { message: "hi" }, { priority: 5 });
    expect(created).toBe(true);
    expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({ type: "test.echo", priority: 5, max_attempts: 3 }));
  });

  it("returns the active job for a repeated idempotency key", async () => {
    const repo = fakeRepository();
    const existing = job({ idempotency_key: "k1", status: "queued" });
    repo.findActiveByIdempotencyKey.mockResolvedValue(existing);
    const queue = new JobQueue(repo as unknown as JobRepository, registryWith(async () => null));
    const result = await queue.enqueue("test.echo", { message: "hi" }, { idempotencyKey: "k1" });
    expect(result).toEqual({ job: existing, created: false });
    expect(repo.insert).not.toHaveBeenCalled();
  });
});

describe("JobWorker.run", () => {
  const makeWorker = (repo: ReturnType<typeof fakeRepository>, registry: JobRegistry) =>
    new JobWorker(repo as unknown as JobRepository, registry, { workerId: "w1", logger: silent });

  it("stores output and marks success", async () => {
    const repo = fakeRepository();
    await makeWorker(repo, registryWith(async ({ message }) => ({ echoed: message }))).run(job());
    expect(repo.addResult).toHaveBeenCalledWith(job().id, { echoed: "hi" });
    expect(repo.markSucceeded).toHaveBeenCalledWith(job().id, "w1");
  });

  it("schedules a retry for transient failures", async () => {
    const repo = fakeRepository();
    await makeWorker(repo, registryWith(async () => {
      throw new AppError("UPSTREAM_ERROR", "YouTube 503", { retryable: true });
    })).run(job({ attempts: 1 }));
    const [, , message, retryAt] = repo.markFailed.mock.calls[0] as unknown as [string, string, string, Date | null];
    expect(message).toBe("YouTube 503");
    expect(retryAt).toBeInstanceOf(Date);
  });

  it("runs handlers in a background quota context and defers quota-blocked jobs without using an attempt", async () => {
    const repo = { ...fakeRepository(), defer: vi.fn(async () => {}) };
    let seen: unknown;
    const retryAt = new Date("2026-09-17T07:00:00Z");
    await makeWorker(repo, registryWith(async () => {
      seen = currentQuotaContext();
      throw new QuotaUnavailableError("background", retryAt, "lane");
    })).run(job({ attempts: 2 }));
    expect(seen).toMatchObject({ lane: "background", operation: "job:test.echo" });
    expect(repo.defer).toHaveBeenCalledWith(expect.objectContaining({ attempts: 2 }), "w1", retryAt, expect.any(String));
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it("fails permanently on validation errors or exhausted attempts", async () => {
    const repo = fakeRepository();
    await makeWorker(repo, registryWith(async () => {
      throw new ValidationError("bad");
    })).run(job({ attempts: 1 }));
    await makeWorker(repo, registryWith(async () => {
      throw new Error("boom");
    })).run(job({ attempts: 3, max_attempts: 3 }));
    expect(repo.markFailed.mock.calls.map((c) => (c as unknown[])[3])).toEqual([null, null]);
  });
});

describe("JobWorker.drain", () => {
  it("runs jobs until the queue is empty", async () => {
    const repo = fakeRepository();
    repo.claim.mockResolvedValueOnce([job({ id: "a" })]).mockResolvedValueOnce([job({ id: "b" })]).mockResolvedValue([]);
    const worker = new JobWorker(repo as unknown as JobRepository, registryWith(async () => null), { workerId: "w1", logger: silent });
    expect(await worker.drain({ deadline: Date.now() + 10_000, maxJobs: 10 })).toEqual({ processed: 2, stoppedBy: "empty" });
    expect(repo.markSucceeded).toHaveBeenCalledTimes(2);
  });

  it("tells a running job the deadline passed, instead of waiting for it", async () => {
    // The live bug this covers: one gate-paced job ran for minutes, so the cron
    // tick never answered and every job behind it waited for the next tick.
    const repo = fakeRepository();
    repo.claim.mockResolvedValueOnce([job({ id: "slow" })]).mockResolvedValue([]);
    let sawAbort = false;
    const registry = new JobRegistry().register(
      defineJob({
        type: "test.echo",
        description: "echo",
        payloadSchema: z.object({ message: z.string() }),
        handler: async (_payload, { signal }) => {
          await new Promise<void>((resolve) =>
            signal.aborted ? resolve() : signal.addEventListener("abort", () => resolve(), { once: true }),
          );
          sawAbort = signal.aborted;
          return null as never;
        },
      }),
    );
    const worker = new JobWorker(repo as unknown as JobRepository, registry, { workerId: "w1", logger: silent });
    const result = await worker.drain({ deadline: Date.now() + 50, maxJobs: 5 });
    expect(sawAbort).toBe(true);
    expect(result.processed).toBe(1);
  });

  it("stops at maxJobs and at the deadline", async () => {
    const repo = fakeRepository();
    repo.claim.mockResolvedValue([job()]);
    const worker = new JobWorker(repo as unknown as JobRepository, registryWith(async () => null), { workerId: "w1", logger: silent });
    expect(await worker.drain({ deadline: Date.now() + 10_000, maxJobs: 3 })).toEqual({ processed: 3, stoppedBy: "max_jobs" });
    expect(await worker.drain({ deadline: Date.now() - 1, maxJobs: 3 })).toEqual({ processed: 0, stoppedBy: "deadline" });
  });
});

describe("retryDelayMs", () => {
  it("grows exponentially with jitter and caps at one hour", () => {
    const mid = () => 0.5;
    expect(retryDelayMs(1, mid)).toBe(30_000);
    expect(retryDelayMs(2, mid)).toBe(120_000);
    expect(retryDelayMs(10, mid)).toBe(3_600_000);
  });
});
