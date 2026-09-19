/**
 * InnerTube scraper: keeps the channel library fresh without spending API quota.
 *
 *   npm run scraper
 *
 * Runs as its own service (deploy/outlier-scraper.service), never inside the web
 * app. It walks the channels that are due for a refresh, a step ahead of the
 * worker's daily API refresh, and reads each one from YouTube's web pages. If a
 * read fails it uses the API for that channel; if YouTube shows a bot check it
 * pauses and the worker's API refresh covers everything until it resumes.
 *
 * Speed, retries, caching, and the circuit breaker all belong to the shared
 * InnerTube gate (INNERTUBE_* settings, see .env.example); this script only
 * decides which channels to read and when to wait. SCRAPER_BATCH sets how many
 * channels a round picks up.
 */
import { logger } from "@/lib/core/logger";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // File is optional.
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Matches the worker's refresh ages, minus a margin so the scraper gets there first. */
const TRACKED_AHEAD = 0.8;
const DISCOVERED_REFRESH_DAYS = 6;
/** Nothing due: look again in a while. */
const IDLE_WAIT = 15 * MINUTE;
/** A channel that failed is left to the worker for this long. */
const SKIP_FAILED_FOR = 24 * HOUR;

const numberSetting = (name: string, fallback: number, min: number, max: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
};

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

async function main(): Promise<void> {
  // Imported after the environment is set up.
  const { env, requireEnv } = await import("@/lib/core/env");
  const { isAppError } = await import("@/lib/core/errors");
  const { isQuotaUnavailable } = await import("@/lib/youtube/quota-manager");
  const { getAdminDatabase } = await import("@/lib/database/client");
  const { getServices, ChannelService } = await import("@/lib/services");
  const { runWithQuotaContext } = await import("@/lib/youtube");
  const { createHybridSource, getGate, InnerTubeBlockedError } = await import("@/lib/innertube");

  const config = env();
  getAdminDatabase();
  requireEnv("YOUTUBE_API_KEY");
  const services = getServices();
  const channelsRepo = services.repositories.channels;

  const batch = numberSetting("SCRAPER_BATCH", 20, 1, 200);
  const gate = getGate();
  // A refresh the scraper can't get from YouTube's pages is worth one API read:
  // the quota manager still decides whether that read happens.
  const source = createHybridSource({ apiFallback: true });
  const channels = new ChannelService(source, channelsRepo, services.repositories.videos, {
    storage: services.storage,
    snapshotVideoMaxAgeDays: config.SNAPSHOT_VIDEO_MAX_AGE_DAYS,
    language: config.OUTLIER_LANGUAGE.toLowerCase(),
  });

  const controller = new AbortController();
  const stop = (signal: string) => {
    logger.info("scraper stopping after the current channel", { signal });
    controller.abort();
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  logger.info("scraper started", { batch, perMinute: config.INNERTUBE_REQUESTS_PER_MINUTE });

  const skipUntil = new Map<string, number>();

  while (!controller.signal.aborted) {
    const storage = await services.storage.getStatus({ fresh: true });
    if (storage.level === "over_budget") {
      logger.warn("scraper idle: storage budget reached");
      await sleep(6 * HOUR, controller.signal);
      continue;
    }

    const now = Date.now();
    const due = await channelsRepo.listDueForRefresh(
      new Date(now - config.SYNC_INTERVAL_HOURS * TRACKED_AHEAD * HOUR),
      new Date(now - DISCOVERED_REFRESH_DAYS * 24 * HOUR),
      batch + skipUntil.size,
    ).then((rows) => rows.filter((row) => (skipUntil.get(row.youtube_channel_id) ?? 0) < now).slice(0, batch));
    for (const [id, until] of skipUntil) if (until < now) skipUntil.delete(id);
    if (due.length === 0) {
      await sleep(IDLE_WAIT, controller.signal);
      continue;
    }

    let refreshed = 0;
    for (const channel of due) {
      if (controller.signal.aborted) break;
      try {
        await runWithQuotaContext({ lane: "background", operation: "scraper:refresh" }, () =>
          channels.refreshChannel(channel.youtube_channel_id, { light: !channel.tracked }),
        );
        refreshed += 1;
      } catch (error) {
        skipUntil.set(channel.youtube_channel_id, Date.now() + SKIP_FAILED_FOR);
        // The gate paused scraping and the API couldn't cover this read either: stop the round.
        if (error instanceof InnerTubeBlockedError || isQuotaUnavailable(error)) {
          logger.warn("scraper round cut short", { channelId: channel.youtube_channel_id, error: error.message });
          break;
        }
        if (isAppError(error) && error.code === "NOT_FOUND") continue;
        logger.warn("scraper refresh failed", { channelId: channel.youtube_channel_id, error });
      }
    }

    const state = gate.state();
    logger.info("scraper round", { due: due.length, refreshed, reads: source.takeCounts(), gate: gate.takeStats() });

    // While the gate is paused, don't spin: the worker's API refresh covers channels meanwhile.
    if (state.open && state.openUntil) {
      const pause = Math.max(state.openUntil.getTime() - Date.now(), MINUTE);
      logger.warn("scraper waiting for InnerTube to reopen", { minutes: Math.round(pause / MINUTE), trips: state.trips });
      await sleep(pause, controller.signal);
    }
  }

  logger.info("scraper stopped");
}

main().catch((error: unknown) => {
  logger.error("scraper crashed", { error });
  process.exit(1);
});
