import "server-only";
import type { DatabaseClient } from "@/lib/database/client";
import { unwrap } from "@/lib/database/errors";
import { openingLine } from "@/lib/innertube/transcripts";
import type { Transcript } from "@/lib/youtube/transcripts";
import { transcriptToText } from "@/lib/youtube/transcripts";
import type { VideoTranscriptRow } from "@/types/database";

/**
 * Stored transcripts, one per video.
 *
 * Reading a transcript costs a scrape slot, and a breakout Short's opening
 * reads the same for everyone who asks about it, so it's fetched once and kept.
 */
export class TranscriptRepository {
  constructor(private readonly db: DatabaseClient) {}

  async get(videoId: string): Promise<VideoTranscriptRow | null> {
    const rows = unwrap(await this.db.from("video_transcripts").select("*").eq("video_id", videoId).limit(1), "video_transcripts.get");
    return rows[0] ?? null;
  }

  /** Transcripts for these videos, keyed by video id. Missing ones are simply absent. */
  async forVideos(videoIds: readonly string[]): Promise<Map<string, VideoTranscriptRow>> {
    if (videoIds.length === 0) return new Map();
    const rows = unwrap(await this.db.from("video_transcripts").select("*").in("video_id", [...videoIds]), "video_transcripts.forVideos");
    return new Map(rows.map((row) => [row.video_id, row]));
  }

  /** Which of these videos we haven't read yet — the list worth spending scrape slots on. */
  async missing(videoIds: readonly string[]): Promise<string[]> {
    if (videoIds.length === 0) return [];
    const rows = unwrap(
      await this.db.from("video_transcripts").select("video_id").in("video_id", [...videoIds]),
      "video_transcripts.missing",
    );
    const have = new Set(rows.map((row) => row.video_id));
    return videoIds.filter((id) => !have.has(id));
  }

  /**
   * Record that a video has no transcript to read.
   *
   * Without this the same captionless videos come back from `missing` every run
   * and the backfill spends its whole budget re-reading them — and most Shorts
   * carry no caption track at all, so that is the common case, not the rare one.
   * An empty row means "asked, nothing there"; word_count 0 tells them apart
   * from a real transcript.
   */
  async markUnavailable(videoId: string): Promise<void> {
    unwrap(
      await this.db
        .from("video_transcripts")
        .upsert(
          { video_id: videoId, language: "", source: "captions", segments: [], full_text: "", word_count: 0, fetched_at: new Date().toISOString() },
          { onConflict: "video_id" },
        )
        .select("video_id"),
      "video_transcripts.markUnavailable",
    );
  }

  async save(videoId: string, transcript: Transcript, openingSeconds = 3): Promise<void> {
    const fullText = transcriptToText(transcript);
    unwrap(
      await this.db
        .from("video_transcripts")
        .upsert(
          {
            video_id: videoId,
            language: transcript.language,
            source: transcript.source,
            segments: transcript.segments,
            full_text: fullText,
            opening: openingLine(transcript, openingSeconds),
            word_count: fullText.split(/\s+/).filter(Boolean).length,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: "video_id" },
        )
        .select("video_id"),
      "video_transcripts.save",
    );
  }
}
