import "server-only";
import { env } from "@/lib/core/env";
import { getYouTubeService } from "@/lib/youtube";
import { getGate } from "./config";
import { InnerTubeTranscriptProvider } from "./transcripts";
import { HybridYouTubeSource } from "./hybrid";
import { InnerTubeSource } from "./source";

export { InnerTubeGate, InnerTubeBlockedError, InnerTubeBusyError, looksLikeBlock, getInnerTubeGate, resetInnerTubeGate, INNERTUBE_GATE_DEFAULTS } from "./gate";
export { gateOptionsFromEnv, getGate } from "./config";
export { InnerTubeTranscriptProvider, openingLine } from "./transcripts";
export type { GateState, GateStats, InnerTubeGateOptions } from "./gate";
export { InnerTubeSource, parseCountText } from "./source";
export { InnerTubeSearch, SCRAPEABLE_ORDERS, uploadDateBucket, durationFilter } from "./search";
export { HybridYouTubeSource } from "./hybrid";

/**
 * Channel reads that prefer YouTube's web endpoints and fall back to the
 * official API. Shares the process-wide gate, so a second caller inherits the
 * same rate limit, cache, and circuit breaker.
 */
/**
 * Reads what a video says, through the same gate as everything else. Only the
 * scraped path can answer this — the Data API hands captions to the video's
 * owner and nobody else — so callers check INNERTUBE_INGEST_ENABLED first.
 */
export function createTranscriptReader(): InnerTubeTranscriptProvider {
  const config = env();
  const gate = getGate(config);
  const source = new InnerTubeSource(gate, {
    maxVideos: config.INNERTUBE_MAX_VIDEOS,
    userMaxWaitMs: config.INNERTUBE_USER_MAX_WAIT_MS,
  });
  return new InnerTubeTranscriptProvider(gate, source);
}

export function createHybridSource(options: { apiFallback?: boolean } = {}): HybridYouTubeSource {
  const config = env();
  const gate = getGate();
  const source = new InnerTubeSource(gate, {
    maxVideos: config.INNERTUBE_MAX_VIDEOS,
    userMaxWaitMs: config.INNERTUBE_USER_MAX_WAIT_MS,
  });
  return new HybridYouTubeSource(source, getYouTubeService(), gate, { apiFallback: options.apiFallback ?? true });
}
