import type { DatabaseClient } from "@/lib/database/client";
import { assertOk, unwrap, unwrapMaybe } from "@/lib/database/errors";
import type { JobResultRow, JobRow, Json, TablesInsert } from "@/types/database";

export class JobRepository {
  constructor(private readonly db: DatabaseClient) {}

  async insert(row: TablesInsert<"jobs">): Promise<JobRow> {
    return unwrap(await this.db.from("jobs").insert(row).select("*").single(), "jobs.insert");
  }

  async findById(id: string): Promise<JobRow | null> {
    return unwrapMaybe(await this.db.from("jobs").select("*").eq("id", id).maybeSingle(), "jobs.findById");
  }

  async findActiveByIdempotencyKey(key: string): Promise<JobRow | null> {
    return unwrapMaybe(
      await this.db
        .from("jobs")
        .select("*")
        .eq("idempotency_key", key)
        .in("status", ["queued", "running"])
        .maybeSingle(),
      "jobs.findActiveByIdempotencyKey",
    );
  }

  /** Most recently created job of a type (any status) — used by the scheduler. */
  async findLatestByType(type: string): Promise<JobRow | null> {
    const rows = unwrap(
      await this.db.from("jobs").select("*").eq("type", type).order("created_at", { ascending: false }).limit(1),
      "jobs.findLatestByType",
    );
    return rows[0] ?? null;
  }

  /** Output of the most recent successful job of a type (e.g. today's trending picks). */
  async latestSucceededOutput(type: string): Promise<{ output: Json; finishedAt: string | null } | null> {
    const jobs = unwrap(
      await this.db
        .from("jobs")
        .select("id, finished_at")
        .eq("type", type)
        .eq("status", "succeeded")
        .order("finished_at", { ascending: false, nullsFirst: false })
        .limit(1),
      "jobs.latestSucceeded",
    );
    const job = jobs[0];
    if (!job) return null;
    const results = unwrap(
      await this.db.from("job_results").select("output").eq("job_id", job.id).order("created_at", { ascending: false }).limit(1),
      "job_results.latest",
    );
    const output = results[0]?.output;
    return output === undefined || output === null ? null : { output, finishedAt: job.finished_at };
  }

  async claim(workerId: string, batchSize: number, types?: string[]): Promise<JobRow[]> {
    return unwrap(
      await this.db.rpc("claim_jobs", { worker_id: workerId, batch_size: batchSize, job_types: types ?? null }),
      "jobs.claim",
    );
  }

  async requeueStale(lockTimeout: string): Promise<number> {
    return unwrap(await this.db.rpc("requeue_stale_jobs", { lock_timeout: lockTimeout }), "jobs.requeueStale");
  }

  /** Mark succeeded; guarded by locked_by so a worker whose lock expired can't overwrite a newer attempt. */
  async markSucceeded(id: string, workerId: string): Promise<void> {
    assertOk(
      await this.db
        .from("jobs")
        .update({ status: "succeeded", finished_at: new Date().toISOString(), locked_at: null, locked_by: null, last_error: null })
        .eq("id", id)
        .eq("locked_by", workerId),
      "jobs.markSucceeded",
    );
  }

  async markFailed(id: string, workerId: string, error: string, retryAt: Date | null): Promise<void> {
    const update =
      retryAt === null
        ? { status: "failed" as const, finished_at: new Date().toISOString() }
        : { status: "queued" as const, run_at: retryAt.toISOString() };
    assertOk(
      await this.db
        .from("jobs")
        .update({ ...update, last_error: error.slice(0, 4000), locked_at: null, locked_by: null })
        .eq("id", id)
        .eq("locked_by", workerId),
      "jobs.markFailed",
    );
  }

  async cancel(id: string): Promise<JobRow | null> {
    return unwrapMaybe(
      await this.db
        .from("jobs")
        .update({ status: "cancelled", finished_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "queued")
        .select("*")
        .maybeSingle(),
      "jobs.cancel",
    );
  }

  async addResult(jobId: string, output: Json, kind = "output"): Promise<JobResultRow> {
    return unwrap(
      await this.db.from("job_results").insert({ job_id: jobId, kind, output }).select("*").single(),
      "job_results.insert",
    );
  }

  async listResults(jobId: string): Promise<JobResultRow[]> {
    return unwrap(
      await this.db.from("job_results").select("*").eq("job_id", jobId).order("created_at"),
      "job_results.list",
    );
  }
}
