import { isAppError } from "@/lib/core/errors";
import type { JobRepository } from "@/lib/database/repositories/jobs";
import type { JobRow, Json } from "@/types/database";
import type { JobRegistry } from "./registry";

export interface EnqueueOptions {
  workspaceId?: string | null;
  createdBy?: string | null;
  priority?: number;
  runAt?: Date;
  /** Enqueue is a no-op returning the existing job while one with this key is queued/running. */
  idempotencyKey?: string;
}

export class JobQueue {
  constructor(
    private readonly repository: JobRepository,
    private readonly registry: JobRegistry,
  ) {}

  async enqueue(type: string, payload: unknown, options: EnqueueOptions = {}): Promise<{ job: JobRow; created: boolean }> {
    const definition = this.registry.require(type);
    const parsed = this.registry.parsePayload(type, payload) as Json;

    if (options.idempotencyKey) {
      const existing = await this.repository.findActiveByIdempotencyKey(options.idempotencyKey);
      if (existing) return { job: existing, created: false };
    }

    try {
      const job = await this.repository.insert({
        type,
        payload: parsed,
        workspace_id: options.workspaceId ?? null,
        created_by: options.createdBy ?? null,
        priority: options.priority ?? 0,
        run_at: (options.runAt ?? new Date()).toISOString(),
        max_attempts: definition.maxAttempts ?? 3,
        idempotency_key: options.idempotencyKey ?? null,
      });
      return { job, created: true };
    } catch (error) {
      // Lost a race with a concurrent enqueue using the same key.
      if (options.idempotencyKey && isAppError(error) && error.code === "CONFLICT") {
        const existing = await this.repository.findActiveByIdempotencyKey(options.idempotencyKey);
        if (existing) return { job: existing, created: false };
      }
      throw error;
    }
  }
}
