import { AiBalanceEmptyError } from "@/lib/ai/balance";
import { AiBudgetSpentError } from "@/lib/ai/budget";
import type { TextProvider } from "@/lib/ai/types";
import { buildVideoBreakdownPrompt, cleanBreakdown, VIDEO_BREAKDOWN_SYSTEM, videoBreakdownSchema } from "@/lib/breakdowns/video";
import { isAppError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { VideoBreakdownRepository } from "@/lib/database/repositories/breakdowns";
import type { VideoRepository } from "@/lib/database/repositories/videos";
import type { VideoFeedRow } from "@/types/database";

/** Only videos that clearly beat their channel are worth explaining. */
const MIN_OUTLIER = 3;
const DAY_MS = 86_400_000;

/**
 * "Why it blew up" for the videos at the top of Viral Videos: Claude Haiku
 * looks at the thumbnail, title and numbers and files each one under the
 * shared vocabulary (hook, style, angle) with a title template and what to
 * copy. About $0.0003 a video; runs hourly from the background budget, newest
 * outliers first, so the feed members actually see gets covered before the
 * long tail.
 */
export class VideoBreakdownService {
  private readonly log: Logger;

  constructor(
    private readonly deps: {
      ai: TextProvider | null;
      videos: Pick<VideoRepository, "feed">;
      breakdowns: Pick<VideoBreakdownRepository, "existing" | "save">;
    },
  ) {
    this.log = createLogger({ module: "services.breakdowns" });
  }

  async breakdownPending(options: { maxVideos: number; signal?: AbortSignal }, now: Date = new Date()): Promise<{ analyzed: number; failed: number; skipped?: string }> {
    const ai = this.deps.ai;
    if (!ai) return { analyzed: 0, failed: 0, skipped: "no ANTHROPIC_API_KEY" };
    if (options.maxVideos <= 0) return { analyzed: 0, failed: 0 };

    const due = await this.dueVideos(options.maxVideos, now);
    let analyzed = 0;
    let failed = 0;
    for (const video of due) {
      if (options.signal?.aborted) break;
      try {
        const { object, model } = await ai.generateObject({
          system: VIDEO_BREAKDOWN_SYSTEM,
          messages: [{ role: "user", content: buildVideoBreakdownPrompt(video), images: [`https://i.ytimg.com/vi/${video.youtube_video_id}/hqdefault.jpg`] }],
          schema: videoBreakdownSchema,
          schemaName: "video_breakdown",
          effort: "low",
          maxOutputTokens: 3_000,
          signal: options.signal,
        });
        const clean = cleanBreakdown(object);
        await this.deps.breakdowns.save([{ video_id: video.video_id, ...clean, model, analyzed_at: now.toISOString() }]);
        analyzed += 1;
      } catch (error) {
        failed += 1;
        this.log.warn("video breakdown failed", { videoId: video.video_id, error });
        // An unusable answer about one video: move on. Out of budget, rate limited or down: stop until next hour.
        if (error instanceof AiBudgetSpentError || error instanceof AiBalanceEmptyError || !isAppError(error) || error.code !== "UPSTREAM_ERROR") break;
      }
    }
    this.log.info("video breakdown run", { due: due.length, analyzed, failed });
    return { analyzed, failed };
  }

  /** The strongest recent outliers without a breakdown: this week's first, then the month's. */
  private async dueVideos(limit: number, now: Date): Promise<VideoFeedRow[]> {
    const [week, month] = await Promise.all([
      this.deps.videos.feed({ orderBy: "outlier_score", limit: 200, publishedAfter: new Date(now.getTime() - 7 * DAY_MS), discovery: true }),
      this.deps.videos.feed({ orderBy: "outlier_score", limit: 400, publishedAfter: new Date(now.getTime() - 30 * DAY_MS), discovery: true }),
    ]);
    const seen = new Set<string>();
    const candidates = [...week, ...month].filter((v) => {
      if (seen.has(v.video_id) || (v.outlier_score ?? 0) < MIN_OUTLIER || v.format === "upcoming") return false;
      seen.add(v.video_id);
      return true;
    });
    if (candidates.length === 0) return [];
    const done = await this.deps.breakdowns.existing(candidates.map((v) => v.video_id));
    return candidates.filter((v) => !done.has(v.video_id)).slice(0, limit);
  }
}
