import { describe, expect, it, vi } from "vitest";
import { TranscriptService } from "@/lib/services/transcript-service";
import type { Transcript } from "@/lib/youtube/transcripts";
import { createLogger } from "@/lib/core/logger";

function transcript(text: string): Transcript {
  return { videoId: "x", language: "en", source: "captions", segments: [{ startSeconds: 0, durationSeconds: 2, text }] };
}

function deps(over: { feed?: unknown[]; missing?: string[]; get?: (id: string) => Promise<Transcript> } = {}) {
  const save = vi.fn(async () => {});
  const feed = vi.fn(async () => over.feed ?? []);
  const missing = vi.fn(async () => over.missing ?? []);
  const getTranscript = vi.fn(over.get ?? (async () => transcript("watch this")));
  return {
    save,
    feed,
    missing,
    getTranscript,
    service: new TranscriptService({
      videos: { feed } as never,
      transcripts: { missing, save } as never,
      reader: { getTranscript } as never,
      logger: createLogger({ level: "silent" }),
    }),
  };
}

const row = (id: string) => ({ video_id: id, youtube_video_id: `yt${id}` });

describe("TranscriptService.backfillOnce", () => {
  it("reads the highest-scoring Shorts we haven't read yet", async () => {
    const d = deps({ feed: [row("a"), row("b"), row("c")], missing: ["b", "c"] });
    const result = await d.service.backfillOnce({ limit: 10, days: 60 });

    expect(d.feed).toHaveBeenCalledWith(expect.objectContaining({ orderBy: "outlier_score", format: "short" }));
    expect(d.getTranscript.mock.calls.map((c) => c[0])).toEqual(["ytb", "ytc"]);
    expect(result).toMatchObject({ missing: 2, stored: 2, failed: 0 });
  });

  it("stops at the run's limit and leaves the rest for next time", async () => {
    const d = deps({ feed: [row("a"), row("b"), row("c")], missing: ["a", "b", "c"] });
    const result = await d.service.backfillOnce({ limit: 1, days: 60 });
    expect(d.save).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ missing: 3, stored: 1 });
  });

  it("counts a video with no captions instead of failing the run", async () => {
    const d = deps({
      feed: [row("a"), row("b")],
      missing: ["a", "b"],
      get: async (id) => {
        if (id === "yta") throw new Error("no captions");
        return transcript("ok");
      },
    });
    const result = await d.service.backfillOnce({ limit: 10, days: 60 });
    expect(result).toMatchObject({ stored: 1, failed: 1 });
  });

  it("does nothing without a reader, because the Data API can't see transcripts", async () => {
    const service = new TranscriptService({ videos: { feed: vi.fn() } as never, transcripts: {} as never, reader: null, logger: createLogger({ level: "silent" }) });
    expect(await service.backfillOnce({ limit: 10, days: 60 })).toMatchObject({ stored: 0, candidates: 0 });
  });

  it("stops when the job is aborted mid-run", async () => {
    const controller = new AbortController();
    const d = deps({ feed: [row("a"), row("b")], missing: ["a", "b"] });
    d.getTranscript.mockImplementation(async () => {
      controller.abort();
      return transcript("first");
    });
    const result = await d.service.backfillOnce({ limit: 10, days: 60, signal: controller.signal });
    expect(result.stored).toBe(1);
  });
});
