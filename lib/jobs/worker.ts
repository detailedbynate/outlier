import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { isAppError, serializeError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { JobRepository } from "@/lib/database/repositories/jobs";
import type { JobRow } from "@/types/database";
import { retryDelayMs } from "./backoff";
import type { JobRegistry } from "./registry";

export interface JobWorkerOptions {
  concurrency?: number;
  pollIntervalMs?: number;
  /** Jobs locked longer than this are assumed orphaned and requeued. */
  staleLockTimeout?: string;
  workerId?: string;
  logger?: Logger;
}

/**
 * Polls Postgres for due jobs and runs them through registered handlers.
 * Run as a separate long-lived process (`npm run worker`), not inside Next.js request handlers.
 */
export class JobWorker {
  readonly workerId: string;
  private readonly concurrency: number;
  private readonly pollIntervalMs: number;
  private readonly staleLockTimeout: string;
  private readonly log: Logger;
  private readonly abort = new AbortController();
  private readonly active = new Set<Promise<void>>();
  private lastStaleCheck = 0;

  constructor(
    private readonly repository: JobRepository,
    private readonly registry: JobRegistry,
    options: JobWorkerOptions = {},
  ) {
    this.workerId = options.workerId ?? `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
    this.concurrency = options.concurrency ?? 2;
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.staleLockTimeout = options.staleLockTimeout ?? "15 minutes";
    this.log = options.logger ?? createLogger({ module: "jobs.worker", workerId: this.workerId });
  }

  async start(): Promise<void> {
    this.log.info("worker started", { concurrency: this.concurrency, types: this.registry.types() });
    while (!this.abort.signal.aborted) {
      try {
        await this.maybeRequeueStale();
        const processed = await this.tick();
        if (processed === 0) await this.sleep(this.pollIntervalMs);
      } catch (error) {
        this.log.error("worker loop error", { error: serializeError(error) });
        await this.sleep(this.pollIntervalMs * 2);
      }
    }
    await Promise.allSettled(this.active);
    this.log.info("worker stopped");
  }

  stop(): void {
    this.abort.abort();
  }

  /** Claim and start as many jobs as there are free slots. Returns the number claimed. */
  async tick(): Promise<number> {
    const free = this.concurrency - this.active.size;
    if (free <= 0) {
      await Promise.race(this.active);
      return 1;
    }
    const jobs = await this.repository.claim(this.workerId, free, this.registry.types());
    for (const job of jobs) {
      const run = this.run(job).finally(() => this.active.delete(run));
      this.active.add(run);
    }
    return jobs.length;
  }

  /** Execute one claimed job and record the outcome. Never throws. */
  async run(job: JobRow): Promise<void> {
    const log = this.log.child({ jobId: job.id, jobType: job.type, attempt: job.attempts });
    const startedAt = Date.now();

    try {
      const definition = this.registry.require(job.type);
      const payload = this.registry.parsePayload(job.type, job.payload);
      log.info("job started");
      const output = await definition.handler(payload, { job, attempt: job.attempts, logger: log, signal: this.abort.signal });
      if (output !== undefined) await this.repository.addResult(job.id, output);
      await this.repository.markSucceeded(job.id, this.workerId);
      log.info("job succeeded", { durationMs: Date.now() - startedAt });
    } catch (error) {
      // Validation/not-found errors won't fix themselves; everything else is retried until max_attempts.
      const permanent = isAppError(error) && !error.retryable && error.status < 500;
      const exhausted = job.attempts >= job.max_attempts;
      const retryAt = permanent || exhausted ? null : new Date(Date.now() + retryDelayMs(job.attempts));
      const message = error instanceof Error ? error.message : String(error);

      log.error("job failed", { durationMs: Date.now() - startedAt, willRetry: retryAt !== null, error: serializeError(error) });
      try {
        await this.repository.markFailed(job.id, this.workerId, message, retryAt);
      } catch (markError) {
        // The stale-lock sweeper will eventually requeue it.
        log.error("could not record job failure", { error: serializeError(markError) });
      }
    }
  }

  private async maybeRequeueStale(): Promise<void> {
    if (Date.now() - this.lastStaleCheck < 60_000) return;
    this.lastStaleCheck = Date.now();
    const count = await this.repository.requeueStale(this.staleLockTimeout);
    if (count > 0) this.log.warn("requeued stale jobs", { count });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        this.abort.signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      this.abort.signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}
