import { isAppError, serializeError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { JobRepository } from "@/lib/database/repositories/jobs";
import type { JobRow } from "@/types/database";
import { runWithQuotaContext } from "@/lib/youtube/quota-context";
import { isQuotaUnavailable } from "@/lib/youtube/quota-manager";
import { retryDelayMs } from "./backoff";
import type { JobRegistry } from "./registry";
import type { JobScheduler } from "./scheduler";

export interface JobWorkerOptions {
  concurrency?: number;
  pollIntervalMs?: number;
  /** Jobs locked longer than this are assumed orphaned and requeued. */
  staleLockTimeout?: string;
  workerId?: string;
  logger?: Logger;
  /** Recurring jobs (daily sync, pruning), checked every `scheduleCheckMs`. */
  scheduler?: Pick<JobScheduler, "tick">;
  scheduleCheckMs?: number;
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
  private lastScheduleCheck = 0;
  private readonly scheduler?: Pick<JobScheduler, "tick">;
  private readonly scheduleCheckMs: number;

  constructor(
    private readonly repository: JobRepository,
    private readonly registry: JobRegistry,
    options: JobWorkerOptions = {},
  ) {
    this.workerId = options.workerId ?? `worker:${crypto.randomUUID().slice(0, 13)}`;
    this.concurrency = options.concurrency ?? 2;
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.staleLockTimeout = options.staleLockTimeout ?? "15 minutes";
    this.log = options.logger ?? createLogger({ module: "jobs.worker", workerId: this.workerId });
    this.scheduler = options.scheduler;
    this.scheduleCheckMs = options.scheduleCheckMs ?? 5 * 60_000;
  }

  async start(): Promise<void> {
    this.log.info("worker started", { concurrency: this.concurrency, types: this.registry.types() });
    while (!this.abort.signal.aborted) {
      try {
        await this.maybeRequeueStale();
        await this.maybeRunScheduler();
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

  /**
   * Run jobs one at a time until the queue is empty, `maxJobs` is reached, or
   * the deadline passes. For serverless callers (the cron endpoint), where a
   * long-lived polling loop isn't possible.
   */
  async drain(options: { deadline: number; maxJobs: number }): Promise<{ processed: number; stoppedBy: "empty" | "deadline" | "max_jobs" }> {
    let processed = 0;
    while (processed < options.maxJobs) {
      if (Date.now() >= options.deadline) return { processed, stoppedBy: "deadline" };
      const [job] = await this.repository.claim(this.workerId, 1, this.registry.types());
      if (!job) return { processed, stoppedBy: "empty" };
      await this.run(job);
      processed += 1;
    }
    return { processed, stoppedBy: "max_jobs" };
  }

  /** Execute one claimed job and record the outcome. Never throws. */
  async run(job: JobRow): Promise<void> {
    const log = this.log.child({ jobId: job.id, jobType: job.type, attempt: job.attempts });
    const startedAt = Date.now();

    try {
      const definition = this.registry.require(job.type);
      const payload = this.registry.parsePayload(job.type, job.payload);
      log.info("job started");
      // Every YouTube request inside a job is background work, attributed to the job type.
      const output = await runWithQuotaContext({ lane: "background", operation: `job:${job.type}`, fresh: definition.freshData }, () =>
        definition.handler(payload, { job, attempt: job.attempts, logger: log, signal: this.abort.signal }),
      );
      if (output !== undefined) await this.repository.addResult(job.id, output);
      await this.repository.markSucceeded(job.id, this.workerId);
      log.info("job succeeded", { durationMs: Date.now() - startedAt });
    } catch (error) {
      if (isQuotaUnavailable(error)) {
        // Out of quota isn't a failure: wait for the budget to reset and try again, without using an attempt.
        log.warn("job deferred: youtube quota unavailable", { retryAt: error.retryAt.toISOString() });
        try {
          await this.repository.defer(job, this.workerId, error.retryAt, error.message);
        } catch (deferError) {
          log.error("could not defer job", { error: serializeError(deferError) });
        }
        return;
      }
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

  private async maybeRunScheduler(): Promise<void> {
    if (!this.scheduler || Date.now() - this.lastScheduleCheck < this.scheduleCheckMs) return;
    this.lastScheduleCheck = Date.now();
    await this.scheduler.tick();
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
