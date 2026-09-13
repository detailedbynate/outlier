import { serializeError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { JobRow } from "@/types/database";
import type { EnqueueOptions } from "./queue";

export interface Schedule {
  type: string;
  payload?: Record<string, unknown>;
  everyHours: number;
}

export interface SchedulerDependencies {
  findLatestByType: (type: string) => Promise<JobRow | null>;
  enqueue: (type: string, payload: unknown, options?: EnqueueOptions) => Promise<unknown>;
}

/**
 * Minimal recurring-job scheduler (no cron infrastructure). Runs inside the
 * worker: a schedule is due when no job of its type was created within its
 * interval. State lives in the jobs table, so restarts and multiple workers are safe
 * (the idempotency key prevents duplicate enqueues).
 */
export class JobScheduler {
  private readonly log: Logger;

  constructor(
    private readonly deps: SchedulerDependencies,
    private readonly schedules: readonly Schedule[],
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger({ module: "jobs.scheduler" });
  }

  /** Enqueue every due schedule. Returns the types that were enqueued. */
  async tick(now: Date = new Date()): Promise<string[]> {
    const enqueued: string[] = [];
    for (const schedule of this.schedules) {
      try {
        const latest = await this.deps.findLatestByType(schedule.type);
        const dueAt = latest ? Date.parse(latest.created_at) + schedule.everyHours * 3_600_000 : 0;
        if (now.getTime() < dueAt) continue;

        await this.deps.enqueue(schedule.type, schedule.payload ?? {}, { idempotencyKey: `schedule:${schedule.type}` });
        enqueued.push(schedule.type);
        this.log.info("scheduled job enqueued", { type: schedule.type });
      } catch (error) {
        this.log.error("schedule tick failed", { type: schedule.type, error: serializeError(error) });
      }
    }
    return enqueued;
  }
}
