import { env } from "@/lib/core/env";
import { createLogger } from "@/lib/core/logger";
import { getInnerTubeGate, type InnerTubeGate, type InnerTubeGateOptions } from "./gate";
import { FileGateState } from "./shared-state";

/**
 * Gate settings from the environment, in their own module so both the YouTube
 * service and the scraper can build the shared gate without importing each other.
 */
export function gateOptionsFromEnv(config = env()): Partial<InnerTubeGateOptions> {
  return {
    requestsPerMinute: config.INNERTUBE_REQUESTS_PER_MINUTE,
    userRequestsPerMinute: config.INNERTUBE_USER_REQUESTS_PER_MINUTE,
    maxConcurrent: config.INNERTUBE_MAX_CONCURRENT,
    maxRetries: config.INNERTUBE_MAX_RETRIES,
    failureThreshold: config.INNERTUBE_FAILURE_THRESHOLD,
    breakerMs: config.INNERTUBE_BREAKER_MINUTES * 60_000,
    maxBreakerMs: config.INNERTUBE_MAX_BREAKER_HOURS * 3_600_000,
    cacheTtlMs: config.INNERTUBE_CACHE_TTL_SECONDS * 1_000,
  };
}

/**
 * The process-wide gate, configured from the environment.
 *
 * With INNERTUBE_SHARED_STATE_PATH set, the rate budget and the breaker are
 * shared with every other process pointed at the same file — the scraper, the
 * web app's discovery jobs and its live searches all leave from one IP, so
 * pacing them separately only tells YouTube how many processes we run.
 */
export function getGate(config = env()): InnerTubeGate {
  const path = config.INNERTUBE_SHARED_STATE_PATH;
  const shared = path
    ? new FileGateState(path, { onError: (error) => createLogger({ module: "innertube.shared" }).warn("shared gate state unavailable", { error }) })
    : undefined;
  return getInnerTubeGate(gateOptionsFromEnv(config), shared);
}
