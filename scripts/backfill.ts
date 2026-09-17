/**
 * Pre-launch backfill: grow and label the channel library as fast as YouTube
 * quota and the storage budget allow.
 *
 *   npm run backfill                 runs until Ctrl+C
 *   npm run backfill -- --hours 48   stops after 48 hours
 *
 * Each cycle follows featured channels and searches thin niches, imports the
 * creators that turned up, then labels them. When the daily quota runs out it
 * waits and resumes after the reset (midnight Pacific). It stops for good when
 * the database reaches STORAGE_BUDGET_MB.
 *
 * Nobody is using the app yet, so this process keeps a smaller slice of quota
 * back for users than production does. Override any of these defaults by
 * setting the variable before running.
 */
import { logger } from "@/lib/core/logger";

// Featured channels find a new creator for about a unit of quota; a search costs
// 100-300 units and most English-market results get filtered out. So searches get
// a small daily slice and featured channels get the rest.
const BACKFILL_DEFAULTS: Record<string, string> = {
  YOUTUBE_USER_RESERVE_UNITS: "500",
  LIBRARY_FEATURED_CHECKS_PER_RUN: "300",
  LIBRARY_FEATURED_NEW_PER_RUN: "400",
  LIBRARY_GROWTH_SEARCHES_PER_RUN: "2",
  LIBRARY_GROWTH_DAILY_SEARCHES: "16",
  LIBRARY_GROWTH_RESEED_DAYS: "3",
};

// Defaults go in before .env.local is read (loadEnvFile never overwrites), and before env() is parsed.
for (const [key, value] of Object.entries(BACKFILL_DEFAULTS)) process.env[key] ??= value;
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // File is optional.
  }
}

const CYCLE_JOB_MINUTES = 12;
const REPORT_EVERY_CYCLES = 4;
const IDLE_WAIT_MINUTES = 20;
const MINUTE = 60_000;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

function hoursArg(): number | null {
  const index = process.argv.indexOf("--hours");
  const hours = index >= 0 ? Number(process.argv[index + 1]) : NaN;
  return Number.isFinite(hours) && hours > 0 ? hours : null;
}

async function main(): Promise<void> {
  // Imported after the environment is set up.
  const { requireEnv } = await import("@/lib/core/env");
  const { getAdminDatabase } = await import("@/lib/database/client");
  const { JobWorker } = await import("@/lib/jobs/worker");
  const { getServices } = await import("@/lib/services");
  const { runWithQuotaContext } = await import("@/lib/youtube/quota-context");

  getAdminDatabase();
  requireEnv("YOUTUBE_API_KEY");
  const services = getServices();
  const worker = new JobWorker(services.repositories.jobs, services.jobRegistry, { workerId: "backfill" });

  const controller = new AbortController();
  process.once("SIGINT", () => {
    logger.info("backfill stopping after the current step");
    controller.abort();
  });
  const hours = hoursArg();
  const stopAt = hours ? Date.now() + hours * 3_600_000 : Infinity;
  const startedWith = await services.repositories.channels.count();
  let cycle = 0;

  while (!controller.signal.aborted && Date.now() < stopAt) {
    cycle += 1;
    const storage = await services.storage.getStatus({ fresh: true });
    if (storage.level === "over_budget") {
      logger.warn("backfill stopped: storage budget reached", { usedMb: Math.round(storage.usedBytes / 1_048_576) });
      break;
    }

    // Label first: featured-channel growth follows confidently labeled channels.
    await services.nicheLabeling.labelPending({ maxChannels: 500, signal: controller.signal }).catch((error: unknown) => {
      logger.warn("backfill labeling step failed", { error });
    });

    const growth = await runWithQuotaContext({ lane: "background", operation: "backfill:grow" }, () =>
      services.libraryGrowth.growOnce({ signal: controller.signal }),
    ).catch((error: unknown) => {
      logger.warn("backfill growth step failed", { error });
      return null;
    });

    const jobs = await worker.drain({ deadline: Date.now() + CYCLE_JOB_MINUTES * MINUTE, maxJobs: 2_000 });
    const labels = await services.nicheLabeling.labelPending({ maxChannels: 500, signal: controller.signal }).catch((error: unknown) => {
      logger.warn("backfill labeling step failed", { error });
      return null;
    });

    // Every few cycles, build Niche Finder reports for the games and topics the library knows
    // well, so searches for them answer instantly. Reports come from stored data; a thin topic may
    // make one capped YouTube fetch.
    let reports = 0;
    if (cycle % REPORT_EVERY_CYCLES === 1) {
      const entities = await services.repositories.niches.listEntities({ minChannels: 3, limit: 60 }).catch(() => []);
      for (const entity of entities) {
        if (controller.signal.aborted) break;
        await runWithQuotaContext({ lane: "background", operation: "backfill:niche_report" }, () => services.niches.research(entity.name, { userId: null }))
          .then(() => {
            reports += 1;
          })
          .catch((error: unknown) => logger.warn("backfill niche report failed", { niche: entity.name, error }));
      }
    }

    const total = await services.repositories.channels.count();
    const quota = await services.quota.summary().catch(() => null);
    logger.info("backfill cycle", {
      cycle,
      channels: total,
      addedSinceStart: total - startedWith,
      featuredQueued: growth?.featuredQueued ?? 0,
      searched: growth?.searched.length ?? 0,
      jobsRun: jobs.processed,
      labeled: labels?.labeled ?? 0,
      labeledByAi: labels?.byAi ?? 0,
      nicheReports: reports,
      storageMb: Math.round(storage.usedBytes / 1_048_576),
      quotaUsedToday: quota ? `${quota.used.total}/${quota.limits.daily}` : null,
    });

    // Nothing to do (quota spent, queue empty): wait for quota to come back.
    const idle = jobs.processed === 0 && (growth === null || growth.stoppedBy === "quota" || growth.featuredQueued + growth.channelsQueued === 0);
    if (idle) await sleep(IDLE_WAIT_MINUTES * MINUTE, controller.signal);
  }

  logger.info("backfill finished", { channels: await services.repositories.channels.count() });
}

main().catch((error: unknown) => {
  logger.error("backfill crashed", { error });
  process.exit(1);
});
