import { NotFoundError, UpstreamError } from "@/lib/core/errors";
import type { Transcript, TranscriptProvider, TranscriptSegment } from "@/lib/youtube/transcripts";
import type { InnerTubeGate } from "./gate";
import type { InnerTubeSource } from "./source";

/**
 * What a Short actually says, read from the caption track YouTube's own apps play.
 *
 * The Data API only hands captions to the video's owner, which is why this
 * wasn't possible before. The apps show them to everyone, so a transcript costs
 * a scrape slot and no quota at all.
 *
 * Two YouTube endpoints look like they'd do this and don't, as of youtubei.js 18:
 * `get_transcript` (the web transcript panel) answers 400 "Precondition check
 * failed" to anything but a real browser, and the WEB player response comes
 * back UNPLAYABLE with no caption tracks unless it carries a PO token. The iOS
 * and Android app clients still list the tracks, and their timedtext URLs
 * answer without a token — one player request plus one small download, a few
 * hundred milliseconds in all.
 *
 * Auto-generated captions are the normal case: they have no punctuation and
 * they mishear names, which is fine for spotting how an opening is built and
 * useless as a quotation. Nothing here pretends otherwise.
 */

/** Tried in order; the second only when the first can't play the video at all. */
const CLIENTS = ["IOS", "ANDROID"] as const;

const DOWNLOAD_TIMEOUT_MS = 10_000;

export interface CaptionTrack {
  base_url: string;
  language_code: string;
  /** "asr" for auto-generated. */
  kind?: string;
}

/** The parts of a player response this reads. */
interface PlayerInfo {
  playability_status?: { status?: string; reason?: string };
  captions?: { caption_tracks?: CaptionTrack[] };
}

interface Json3 {
  events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[];
}

/**
 * The track worth reading. The auto-generated one is in the language actually
 * spoken; uploaded tracks are often translations. So: a requested language
 * first, then an uploaded track in the spoken language (same words, with
 * punctuation), then the auto-generated one, then whatever there is.
 */
export function pickTrack(tracks: readonly CaptionTrack[], language?: string): CaptionTrack | null {
  if (tracks.length === 0) return null;
  const base = (code: string) => code.toLowerCase().split("-")[0];
  const uploaded = tracks.filter((t) => t.kind !== "asr");
  if (language) {
    const want = base(language);
    const match = uploaded.find((t) => base(t.language_code) === want) ?? tracks.find((t) => base(t.language_code) === want);
    if (match) return match;
  }
  const asr = tracks.find((t) => t.kind === "asr");
  if (asr) return uploaded.find((t) => base(t.language_code) === base(asr.language_code)) ?? asr;
  return tracks[0] ?? null;
}

/** Timed lines out of a json3 caption file. Line breaks inside a cue are layout, not meaning. */
export function parseJson3(body: Json3): TranscriptSegment[] {
  return (body.events ?? []).flatMap((event) => {
    const text = (event.segs ?? []).map((s) => s.utf8 ?? "").join("").replace(/\s+/g, " ").trim();
    const start = Number(event.tStartMs);
    if (!text || !Number.isFinite(start)) return [];
    const duration = Number(event.dDurationMs);
    return [{ startSeconds: start / 1_000, durationSeconds: Number.isFinite(duration) && duration > 0 ? duration / 1_000 : 0, text }];
  });
}

export class InnerTubeTranscriptProvider implements TranscriptProvider {
  readonly name = "innertube";

  constructor(
    private readonly gate: InnerTubeGate,
    private readonly source: InnerTubeSource,
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
  ) {}

  async getTranscript(videoId: string, options: { language?: string } = {}): Promise<Transcript> {
    return this.gate.run({ label: `transcript:${videoId}`, cacheKey: `transcript:${videoId}:${options.language ?? ""}` }, async () => {
      const yt = await this.source.innertube();

      let tracks: CaptionTrack[] = [];
      for (const client of CLIENTS) {
        const info = (await yt.getBasicInfo(videoId, { client })) as PlayerInfo;
        tracks = info.captions?.caption_tracks ?? [];
        if (tracks.length > 0 || info.playability_status?.status === "OK") break;
      }

      // No captions at all is a normal answer, not a failure: plenty of Shorts
      // are music or wordless.
      const track = pickTrack(tracks, options.language);
      if (!track) throw new NotFoundError("transcript", videoId);

      const url = new URL(track.base_url);
      url.searchParams.set("fmt", "json3");
      const response = await this.fetchFn(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      if (!response.ok) throw new UpstreamError("YouTube captions", `timedtext answered ${response.status}`, { retryable: response.status >= 500 });
      const text = await response.text();
      // An empty 200 is how timedtext says "this URL needed a PO token" — the
      // track exists, so it's a failure to retry later, not "nothing to read".
      if (!text.trim()) throw new UpstreamError("YouTube captions", "timedtext answered with an empty body");

      const segments = parseJson3(JSON.parse(text) as Json3);
      if (segments.length === 0) throw new NotFoundError("transcript", videoId);

      return { videoId, language: track.language_code, source: track.kind === "asr" ? "asr" : "captions", segments };
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
