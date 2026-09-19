import { env } from "@/lib/core/env";
import { getInnerTubeGate, type InnerTubeGate, type InnerTubeGateOptions } from "./gate";

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

/** The process-wide gate, configured from the environment. Every InnerTube read shares it. */
export function getGate(config = env()): InnerTubeGate {
  return getInnerTubeGate(gateOptionsFromEnv(config));
}
