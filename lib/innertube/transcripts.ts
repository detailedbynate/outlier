import { NotFoundError } from "@/lib/core/errors";
import type { Transcript, TranscriptProvider, TranscriptSegment } from "@/lib/youtube/transcripts";
import type { InnerTubeGate } from "./gate";
import type { InnerTubeSource } from "./source";

/**
 * What a Short actually says, read from YouTube's own transcript panel.
 *
 * The Data API only hands captions to the video's owner, which is why this
 * wasn't possible before. The web client shows them to everyone, and we already
 * talk to it, so a transcript costs a scrape slot and no quota at all.
 *
 * Auto-generated captions are the normal case: they have no punctuation and
 * they mishear names, which is fine for spotting how an opening is built and
 * useless as a quotation. Nothing here pretends otherwise.
 */

/** Segments and section headers share a list; only segments have text and a start. */
interface RawSegment {
  start_ms?: string;
  end_ms?: string;
  snippet?: { text?: string | null } | null;
}

function toSegment(raw: RawSegment): TranscriptSegment | null {
  const text = raw.snippet?.text?.trim();
  if (!text) return null;
  const start = Number(raw.start_ms);
  const end = Number(raw.end_ms);
  if (!Number.isFinite(start)) return null;
  return {
    startSeconds: start / 1_000,
    durationSeconds: Number.isFinite(end) && end > start ? (end - start) / 1_000 : 0,
    text,
  };
}

export class InnerTubeTranscriptProvider implements TranscriptProvider {
  readonly name = "innertube";

  constructor(
    private readonly gate: InnerTubeGate,
    private readonly source: InnerTubeSource,
  ) {}

  async getTranscript(videoId: string, options: { language?: string } = {}): Promise<Transcript> {
    return this.gate.run({ label: `transcript:${videoId}`, cacheKey: `transcript:${videoId}:${options.language ?? ""}` }, async () => {
      const yt = await this.source.innertube();
      const info = await yt.getInfo(videoId);

      let panel;
      try {
        panel = await info.getTranscript();
      } catch {
        // No captions at all is a normal answer, not a failure: plenty of
        // Shorts are music or wordless.
        throw new NotFoundError("transcript", videoId);
      }

      if (options.language && panel.languages.includes(options.language) && panel.selectedLanguage !== options.language) {
        panel = await panel.selectLanguage(options.language);
      }

      const raw = panel.transcript.content?.body?.initial_segments ?? [];
      const segments = raw.map((node) => toSegment(node as unknown as RawSegment)).filter((s): s is TranscriptSegment => s !== null);
      if (segments.length === 0) throw new NotFoundError("transcript", videoId);

      return { videoId, language: panel.selectedLanguage || "en", source: "captions", segments };
    });
  }
}

/** The opening words, which is the part a hook lives in. */
export function openingLine(transcript: Transcript, seconds = 3): string {
  return transcript.segments
    .filter((s) => s.startSeconds < seconds)
    .map((s) => s.text)
    .join(" ")
    .trim();
}
