import { createLogger, type Logger } from "@/lib/core/logger";
import { serializeError } from "@/lib/core/errors";
import type { TranscriptRepository } from "@/lib/database/repositories/transcripts";
import type { VideoRepository } from "@/lib/database/repositories/videos";
import type { TranscriptProvider } from "@/lib/youtube/transcripts";

/**
 * Fills in what the best Shorts actually say.
 *
 * The script writer's whole advantage is showing a model how real outliers open,
 * not just what they were titled. Reading a transcript on demand is too slow to
 * do inside someone's request — it's a scrape slot, paced by the shared gate — so
 * this walks the library in the background instead, highest outlier score first,
 * and the request finds them already stored.
 *
 * Costs nothing in API quota: transcripts come from the scraped path.
 */

export const TRANSCRIPT_BACKFILL_JOB_TYPE = "transcripts.backfill";

/** How many candidates to pull per run before filtering to the unread ones. */
const CANDIDATE_MULTIPLE = 12;

export interface TranscriptBackfillResult {
  candidates: number;
  missing: number;
  stored: number;
  /** No captions, or the gate turned us away. Neither is worth retrying soon. */
  failed: number;
}

export interface TranscriptServiceDeps {
  videos: Pick<VideoRepository, "feed">;
  transcripts: Pick<TranscriptRepository, "missing" | "save">;
  /** Null wherever scraping is off — the Data API can't see transcripts at all. */
  reader: TranscriptProvider | null;
  logger?: Logger;
}

export class TranscriptService {
  private readonly log: Logger;

  constructor(private readonly deps: TranscriptServiceDeps) {
    this.log = deps.logger ?? createLogger({ module: "services.transcripts" });
  }

  async backfillOnce(options: { limit: number; days: number; signal?: AbortSignal }): Promise<TranscriptBackfillResult> {
    const empty: TranscriptBackfillResult = { candidates: 0, missing: 0, stored: 0, failed: 0 };
    const reader = this.deps.reader;
    if (!reader || options.limit <= 0) return empty;

    const publishedAfter = new Date(Date.now() - options.days * 86_400_000);
    const candidates = await this.deps.videos.feed({
      orderBy: "outlier_score",
      format: "short",
      publishedAfter,
      limit: options.limit * CANDIDATE_MULTIPLE,
    });
    if (candidates.length === 0) return empty;

    const byId = new Map(candidates.flatMap((row) => (row.video_id && row.youtube_video_id ? [[row.video_id, row.youtube_video_id] as const] : [])));
    const missing = await this.deps.transcripts.missing([...byId.keys()]);
    const batch = missing.slice(0, options.limit);

    let stored = 0;
    let failed = 0;
    // Sequential on purpose: the shared gate paces these, and a run that gives up
    // early leaves the rest for the next one instead of queueing behind itself.
    for (const videoId of batch) {
      if (options.signal?.aborted) break;
      const youtubeId = byId.get(videoId);
      if (!youtubeId) continue;
      try {
        await this.deps.transcripts.save(videoId, await reader.getTranscript(youtubeId));
        stored++;
      } catch (error) {
        failed++;
        this.log.debug("transcript unavailable", { youtubeId, error: serializeError(error) });
      }
    }

    const result = { candidates: candidates.length, missing: missing.length, stored, failed };
    this.log.info("transcripts backfilled", result);
    return result;
  }
}
