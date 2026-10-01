import { describe, expect, it } from "vitest";
import { isAppError } from "@/lib/core/errors";
import { InnerTubeGate } from "@/lib/innertube/gate";
import { InnerTubeTranscriptProvider, openingLine, parseJson3, pickTrack, type CaptionTrack } from "@/lib/innertube/transcripts";
import { transcriptToText } from "@/lib/youtube/transcripts";

const event = (start: number, duration: number, ...words: string[]) => ({ tStartMs: start, dDurationMs: duration, segs: words.map((utf8) => ({ utf8 })) });
const asr = (code: string): CaptionTrack => ({ base_url: `https://www.youtube.com/api/timedtext?v=x&lang=${code}&kind=asr`, language_code: code, kind: "asr" });
const uploaded = (code: string): CaptionTrack => ({ base_url: `https://www.youtube.com/api/timedtext?v=x&lang=${code}`, language_code: code });

interface Fake {
  /** Player responses by client; a missing client throws, like an unknown one would. */
  players?: Record<string, unknown>;
  body?: string;
  status?: number;
}

function providerWith(fake: Fake) {
  const calls = { clients: [] as string[], urls: [] as string[] };
  const source = {
    innertube: async () => ({
      getBasicInfo: async (_id: string, options: { client: string }) => {
        calls.clients.push(options.client);
        const player = fake.players?.[options.client];
        if (!player) throw new Error(`no fake for ${options.client}`);
        return player;
      },
    }),
  } as never;
  const fetchFn = (async (url: URL) => {
    calls.urls.push(String(url));
    return new Response(fake.body ?? "", { status: fake.status ?? 200 });
  }) as unknown as typeof fetch;
  return { provider: new InnerTubeTranscriptProvider(gate(), source, fetchFn), calls };
}

const playable = (...tracks: CaptionTrack[]) => ({ playability_status: { status: "OK" }, captions: { caption_tracks: tracks } });
const json3 = (...events: unknown[]) => JSON.stringify({ events });

const gate = () => new InnerTubeGate({ requestsPerMinute: 6_000 }, { sleep: async () => {} });

describe("InnerTube transcripts", () => {
  it("reads the caption track the iOS client lists, as json3", async () => {
    const { provider, calls } = providerWith({
      players: { IOS: playable(asr("en")) },
      body: json3({ tStartMs: 0, dDurationMs: 0 }, event(0, 1_500, "you won't", " believe"), event(1_500, 1_500, "what happened\nnext")),
    });

    const transcript = await provider.getTranscript("abc12345678");
    expect(calls.clients).toEqual(["IOS"]);
    expect(new URL(calls.urls[0]!).searchParams.get("fmt")).toBe("json3");
    expect(transcript).toMatchObject({ videoId: "abc12345678", language: "en", source: "asr" });
    expect(transcript.segments[0]).toEqual({ startSeconds: 0, durationSeconds: 1.5, text: "you won't believe" });
    expect(transcriptToText(transcript)).toBe("you won't believe what happened next");
  });

  it("falls back to the Android client when iOS can't play the video", async () => {
    const { provider, calls } = providerWith({
      players: { IOS: { playability_status: { status: "UNPLAYABLE" } }, ANDROID: playable(uploaded("en")) },
      body: json3(event(0, 900, "real line")),
    });
    const transcript = await provider.getTranscript("abc12345678");
    expect(calls.clients).toEqual(["IOS", "ANDROID"]);
    expect(transcript.source).toBe("captions");
  });

  it("treats a video with no captions as not found, without a second client or a download", async () => {
    const { provider, calls } = providerWith({ players: { IOS: playable() } });
    const error = await provider.getTranscript("abc12345678").catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("NOT_FOUND");
    expect(calls.clients).toEqual(["IOS"]);
    expect(calls.urls).toEqual([]);
  });

  it("treats an empty caption download as a failure to retry, not as nothing to read", async () => {
    const { provider } = providerWith({ players: { IOS: playable(asr("en")) }, body: "" });
    const error = await provider.getTranscript("abc12345678").catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("UPSTREAM_ERROR");
  });

  it("reads a video once however many times it's asked for", async () => {
    const { provider, calls } = providerWith({ players: { IOS: playable(asr("en")) }, body: json3(event(0, 500, "once")) });
    await provider.getTranscript("abc12345678");
    await provider.getTranscript("abc12345678");
    expect(calls.clients).toHaveLength(1);
  });

  it("picks the track in the spoken language over translations", () => {
    expect(pickTrack([uploaded("de-DE"), asr("en")])).toEqual(asr("en"));
    expect(pickTrack([uploaded("de-DE"), uploaded("en"), asr("en")])).toEqual(uploaded("en"));
    expect(pickTrack([uploaded("de-DE"), asr("en")], "de")).toEqual(uploaded("de-DE"));
    expect(pickTrack([uploaded("ja")], "fr")).toEqual(uploaded("ja"));
    expect(pickTrack([])).toBeNull();
  });

  it("skips cues with no words, like the newline-only ones auto captions are full of", () => {
    expect(parseJson3({ events: [event(0, 100, "\n"), { tStartMs: 50 }, event(200, 100, "hi")] })).toEqual([{ startSeconds: 0.2, durationSeconds: 0.1, text: "hi" }]);
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
