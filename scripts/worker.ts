/**
 * Background job worker. Run alongside the Next.js server:
 *   npm run worker
 * Loads .env.local/.env, then polls Postgres for due jobs until SIGINT/SIGTERM.
 */
import { env, requireEnv } from "@/lib/core/env";
import { logger } from "@/lib/core/logger";
import { getAdminDatabase } from "@/lib/database/client";
import { JobWorker } from "@/lib/jobs/worker";
import { getServices } from "@/lib/services";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // File is optional.
  }
}

async function main(): Promise<void> {
  const config = env();
  // Fail fast on missing credentials instead of retrying forever in the poll loop.
  getAdminDatabase();
  requireEnv("YOUTUBE_API_KEY");
  const services = getServices();
  const worker = new JobWorker(services.repositories.jobs, services.jobRegistry, {
    concurrency: config.JOB_WORKER_CONCURRENCY,
    pollIntervalMs: config.JOB_WORKER_POLL_INTERVAL_MS,
  });

  const shutdown = (signal: string) => {
    logger.info("shutdown requested", { signal });
    worker.stop();
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  await worker.start();
}

main().catch((error: unknown) => {
  logger.error("worker crashed", { error });
  process.exit(1);
});
