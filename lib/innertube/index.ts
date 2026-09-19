import "server-only";
import { env } from "@/lib/core/env";
import { getYouTubeService } from "@/lib/youtube";
import { getGate } from "./config";
import { HybridYouTubeSource } from "./hybrid";
import { InnerTubeSource } from "./source";

export { InnerTubeGate, InnerTubeBlockedError, InnerTubeBusyError, looksLikeBlock, getInnerTubeGate, resetInnerTubeGate, INNERTUBE_GATE_DEFAULTS } from "./gate";
export { gateOptionsFromEnv, getGate } from "./config";
export type { GateState, GateStats, InnerTubeGateOptions } from "./gate";
export { InnerTubeSource, parseCountText } from "./source";
export { InnerTubeSearch, SCRAPEABLE_ORDERS, uploadDateBucket, durationFilter } from "./search";
export { HybridYouTubeSource } from "./hybrid";

/**
 * Channel reads that prefer YouTube's web endpoints and fall back to the
 * official API. Shares the process-wide gate, so a second caller inherits the
 * same rate limit, cache, and circuit breaker.
 */
export function createHybridSource(options: { apiFallback?: boolean } = {}): HybridYouTubeSource {
  const config = env();
  const gate = getGate();
  const source = new InnerTubeSource(gate, {
    maxVideos: config.INNERTUBE_MAX_VIDEOS,
    userMaxWaitMs: config.INNERTUBE_USER_MAX_WAIT_MS,
  });
  return new HybridYouTubeSource(source, getYouTubeService(), gate, { apiFallback: options.apiFallback ?? true });
}
