import { AppError, ValidationError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { TextProvider } from "@/lib/ai/types";
import type { TranscriptRepository } from "@/lib/database/repositories/transcripts";
import type { VideoRepository } from "@/lib/database/repositories/videos";
import type { NicheMetrics } from "@/lib/niches/analysis";
import { scriptSystemPrompt, scriptUserPrompt } from "@/lib/scripts/prompt";
import { SCRIPT, type ScriptRequest, type ScriptResult, type ScriptSource } from "@/lib/scripts/schema";
import { pickScriptSources } from "@/lib/scripts/sources";

/**
 * Writes a Short script from the niche's own outliers.
 *
 * The order matters: find the videos that actually beat their channels, read
 * what they opened on, then write. Everything expensive is shared — the niche
 * report is cached for everyone, and a transcript is read once and kept — so
 * the per-request cost is one generation and nothing else.
 *
 * Transcripts are read here only if they're already stored. Fetching one costs a
 * scrape slot and takes about as long as the whole rest of the request, and
 * measured on the library's top Shorts, none of the first twenty carried a
 * caption track — so reading on demand spent a minute or two per script to
 * learn nothing. The scraper fills the table in the background instead, and a
 * niche that does have captions gets the benefit without anyone waiting for it.
 */

export const SCRIPT_EVENT = "script.write";

/** Outliers shown to the writer. Enough to see a pattern, few enough to stay in a small context. */
const MAX_SOURCES = 6;
export interface ScriptDeps {
  ai: TextProvider | null;
  transcripts: TranscriptRepository;
  videos: VideoRepository;
  /** The niche report, already cached by NicheService. */
  metricsFor: (topic: string) => Promise<NicheMetrics | null>;
  logger?: Logger;
}

export class ScriptService {
  private readonly log: Logger;

  constructor(private readonly deps: ScriptDeps) {
    this.log = deps.logger ?? createLogger({ module: "services.scripts" });
  }

  async write(request: ScriptRequest): Promise<ScriptResult> {
    const topic = request.topic.trim();
    const idea = request.idea.trim();
    if (!topic) throw new ValidationError("Pick a niche to write for.");
    if (!idea) throw new ValidationError("Say what the Short should be about.");
    if (!this.deps.ai) throw new AppError("CONFIG_ERROR", "Script writing isn't available right now.", { expose: true });

    const sources = await this.sourcesFor(topic, idea);
    const { object, model } = await this.deps.ai.generateObject({
      system: scriptSystemPrompt(),
      messages: [{ role: "user", content: scriptUserPrompt({ ...request, topic, idea }, sources) }],
      schema: SCRIPT,
      schemaName: "short_script",
      // Scripts want some room to be surprising; the structure is held by the schema.
      temperature: 0.8,
      // The free models reason against max_tokens, and a script that stops
      // halfway is worth nothing, so the budget goes to the answer rather than
      // to thinking about it: "Minecraft" at medium effort ran out mid-script.
      effort: "low",
      maxOutputTokens: 4_000,
    });

    const seconds = object.beats.reduce((total, beat) => total + beat.seconds, 0);
    this.log.info("script written", { topic, sources: sources.length, withOpenings: sources.filter((s) => s.opening).length, seconds, model });
    return { script: object, sources, seconds, model };
  }

  /** The niche's outliers, with their opening words where we can get them. */
  private async sourcesFor(topic: string, idea: string): Promise<ScriptSource[]> {
    const metrics = await this.deps.metricsFor(topic).catch((error: unknown) => {
      // A script from principles alone beats no script at all.
      this.log.warn("script sources unavailable", { topic, error });
      return null;
    });
    // The report's pool is gathered per channel, so it contains videos about
    // other things entirely. Only the ones about this topic teach anything.
    const breakouts = pickScriptSources(metrics?.breakouts ?? [], { topic, idea, format: "short", limit: MAX_SOURCES });
    if (breakouts.length === 0) return [];

    const openings = await this.openingsFor(breakouts.map((b) => b.youtube_video_id)).catch((error: unknown) => {
      this.log.warn("script transcripts unavailable", { topic, error });
      return new Map<string, string>();
    });

    return breakouts.map((breakout) => ({
      youtubeVideoId: breakout.youtube_video_id,
      title: breakout.title,
      channelTitle: breakout.channel_title,
      views: breakout.view_count,
      multiplier: breakout.multiplier,
      opening: openings.get(breakout.youtube_video_id) ?? null,
    }));
  }

  /** Openings the scraper has already stored, keyed by YouTube id. */
  private async openingsFor(youtubeVideoIds: readonly string[]): Promise<Map<string, string>> {
    const ids = await this.deps.videos.idsByYouTubeIds(youtubeVideoIds);
    if (ids.size === 0) return new Map();

    const byInternal = new Map([...ids].map(([youtubeId, internalId]) => [internalId, youtubeId]));
    const stored = await this.deps.transcripts.forVideos([...byInternal.keys()]);
    const openings = new Map<string, string>();
    for (const [internalId, row] of stored) {
      const youtubeId = byInternal.get(internalId);
      // An empty row means the scraper asked and there was nothing to read.
      if (youtubeId && row.opening) openings.set(youtubeId, row.opening);
    }
    return openings;
  }
}
