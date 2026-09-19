import "server-only";
import { env } from "@/lib/core/env";
import { getYouTubeService } from "@/lib/youtube";
import { getInnerTubeGate, type InnerTubeGate, type InnerTubeGateOptions } from "./gate";
import { HybridYouTubeSource } from "./hybrid";
import { InnerTubeSource } from "./source";

export { InnerTubeGate, InnerTubeBlockedError, looksLikeBlock, getInnerTubeGate, resetInnerTubeGate, INNERTUBE_GATE_DEFAULTS } from "./gate";
export type { GateState, GateStats, InnerTubeGateOptions } from "./gate";
export { InnerTubeSource, parseCountText } from "./source";
export { HybridYouTubeSource } from "./hybrid";

export function gateOptionsFromEnv(config = env()): Partial<InnerTubeGateOptions> {
  return {
    requestsPerMinute: config.INNERTUBE_REQUESTS_PER_MINUTE,
    maxConcurrent: config.INNERTUBE_MAX_CONCURRENT,
    maxRetries: config.INNERTUBE_MAX_RETRIES,
    failureThreshold: config.INNERTUBE_FAILURE_THRESHOLD,
    breakerMs: config.INNERTUBE_BREAKER_MINUTES * 60_000,
    maxBreakerMs: config.INNERTUBE_MAX_BREAKER_HOURS * 3_600_000,
    cacheTtlMs: config.INNERTUBE_CACHE_TTL_SECONDS * 1_000,
  };
}

/** The process-wide gate, configured from the environment. Every InnerTube read shares it. */
export function getGate(): InnerTubeGate {
  return getInnerTubeGate(gateOptionsFromEnv());
}

/**
 * Channel reads that prefer YouTube's web endpoints and fall back to the
 * official API. Shares the process-wide gate, so a second caller inherits the
 * same rate limit, cache, and circuit breaker.
 */
export function createHybridSource(options: { apiFallback?: boolean } = {}): HybridYouTubeSource {
  const config = env();
  const gate = getGate();
  const source = new InnerTubeSource(gate, { maxVideos: config.INNERTUBE_MAX_VIDEOS });
  return new HybridYouTubeSource(source, getYouTubeService(), gate, { apiFallback: options.apiFallback ?? true });
}
