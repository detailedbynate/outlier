import { describe, expect, it } from "vitest";
import { isAppError } from "@/lib/core/errors";
import { InnerTubeGate } from "@/lib/innertube/gate";
import { InnerTubeTranscriptProvider, openingLine } from "@/lib/innertube/transcripts";
import { transcriptToText } from "@/lib/youtube/transcripts";

const segment = (start: number, end: number, text: string) => ({
  start_ms: String(start),
  end_ms: String(end),
  snippet: { text },
});

function sourceWith(panel: unknown, onGetInfo = () => {}) {
  return {
    innertube: async () => ({
      getInfo: async () => {
        onGetInfo();
        return { getTranscript: async () => panel };
      },
    }),
  } as never;
}

const panelOf = (segments: unknown[], languages = ["English"], selected = "English") => ({
  languages,
  selectedLanguage: selected,
  transcript: { content: { body: { initial_segments: segments } } },
  selectLanguage: async (language: string) => panelOf(segments, languages, language),
});

const gate = () => new InnerTubeGate({ requestsPerMinute: 6_000 }, { sleep: async () => {} });

describe("InnerTube transcripts", () => {
  it("reads segments with their timings", async () => {
    const provider = new InnerTubeTranscriptProvider(
      gate(),
      sourceWith(panelOf([segment(0, 1_500, "you won't believe"), segment(1_500, 3_000, "what happened next")])),
    );

    const transcript = await provider.getTranscript("abc12345678");
    expect(transcript).toMatchObject({ videoId: "abc12345678", language: "English", source: "captions" });
    expect(transcript.segments[0]).toEqual({ startSeconds: 0, durationSeconds: 1.5, text: "you won't believe" });
    expect(transcriptToText(transcript)).toBe("you won't believe what happened next");
  });

  it("skips section headers, which have no text of their own", async () => {
    const provider = new InnerTubeTranscriptProvider(gate(), sourceWith(panelOf([{ snippet: null }, segment(0, 900, "real line")])));
    const transcript = await provider.getTranscript("abc12345678");
    expect(transcript.segments).toHaveLength(1);
  });

  it("treats a video with no captions as not found, not as a failure", async () => {
    const source = {
      innertube: async () => ({
        getInfo: async () => ({
          getTranscript: async () => {
            throw new Error("Transcript panel not found");
          },
        }),
      }),
    } as never;

    const error = await new InnerTubeTranscriptProvider(gate(), source).getTranscript("abc12345678").catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("NOT_FOUND");
  });

  it("reads a video once however many times it's asked for", async () => {
    let calls = 0;
    const provider = new InnerTubeTranscriptProvider(gate(), sourceWith(panelOf([segment(0, 500, "once")]), () => (calls += 1)));
    await provider.getTranscript("abc12345678");
    await provider.getTranscript("abc12345678");
    expect(calls).toBe(1);
  });

  it("takes the opening words, which is where the hook is", () => {
    const transcript = {
      videoId: "abc12345678",
      language: "English",
      source: "captions" as const,
      segments: [
        { startSeconds: 0, durationSeconds: 1, text: "stop scrolling" },
        { startSeconds: 1.2, durationSeconds: 1, text: "this took me a year" },
        { startSeconds: 8, durationSeconds: 1, text: "and that's the whole story" },
      ],
    };
    expect(openingLine(transcript)).toBe("stop scrolling this took me a year");
  });
});
