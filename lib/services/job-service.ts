import { NotFoundError } from "@/lib/core/errors";
import type { JobRepository } from "@/lib/database/repositories/jobs";
import type { EnqueueOptions, JobQueue } from "@/lib/jobs/queue";
import type { JobResultRow, JobRow } from "@/types/database";

export class JobService {
  constructor(
    private readonly queue: JobQueue,
    private readonly jobs: JobRepository,
  ) {}

  enqueue(type: string, payload: unknown, options: EnqueueOptions = {}): Promise<{ job: JobRow; created: boolean }> {
    return this.queue.enqueue(type, payload, options);
  }

  async get(id: string): Promise<{ job: JobRow; results: JobResultRow[] }> {
    const job = await this.jobs.findById(id);
    if (!job) throw new NotFoundError("Job", id);
    const results = job.status === "succeeded" ? await this.jobs.listResults(id) : [];
    return { job, results };
  }

  async cancel(id: string): Promise<JobRow> {
    const job = await this.jobs.cancel(id);
    if (!job) throw new NotFoundError("Queued job", id);
    return job;
  }
}
