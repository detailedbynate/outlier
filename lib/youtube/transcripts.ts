/**
 * Transcript / video-processing abstractions (not implemented yet).
 *
 * The YouTube Data API only exposes captions to the video owner via OAuth, so
 * transcripts for arbitrary videos will come from a pluggable provider
 * (e.g. a transcription service over downloaded audio, or a third-party API).
 */

export interface TranscriptSegment {
  startSeconds: number;
  durationSeconds: number;
  text: string;
}

export interface Transcript {
  videoId: string;
  language: string;
  source: "captions" | "asr" | "provider";
  segments: TranscriptSegment[];
}

export interface TranscriptProvider {
  readonly name: string;
  getTranscript(videoId: string, options?: { language?: string }): Promise<Transcript>;
}

/** Downstream processing steps for a video (chapters, key moments, hooks...). */
export interface VideoProcessor<TOutput> {
  readonly name: string;
  process(input: { videoId: string; transcript: Transcript }): Promise<TOutput>;
}

export function transcriptToText(transcript: Transcript): string {
  return transcript.segments
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join(" ");
}
