import { apiHandler } from "@/lib/api/handler";
import { JobWorker } from "@/lib/jobs/worker";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";
// Stay within the Vercel Hobby function limit; jobs stop starting ~15s before it.
export const maxDuration = 60;
const WORK_BUDGET_MS = 40_000;

/**
 * POST /api/cron/tick — called on a schedule (GitHub Actions). Enqueues due
 * recurring jobs, recovers stuck ones, then runs queued jobs until the time budget is used.
 */
export const POST = apiHandler({ auth: "cron" }, async ({ requestId }) => {
  const startedAt = Date.now();
  const services = getServices();

  const scheduled = await services.scheduler.tick();
  const requeued = await services.repositories.jobs.requeueStale("15 minutes");
  const worker = new JobWorker(services.repositories.jobs, services.jobRegistry, { workerId: `cron:${requestId}` });
  const result = await worker.drain({ deadline: startedAt + WORK_BUDGET_MS, maxJobs: 100 });

  const quota = await services.quota.summary().catch(() => null);
  return { scheduled, requeued, ...result, quota: quota && { day: quota.day, used: quota.used, limits: quota.limits, denied: quota.denied }, durationMs: Date.now() - startedAt };
});
