import { describe, expect, it } from "vitest";
import { TRANSCRIBE_EVENT, TranscribeService, transcribeDayStart } from "@/lib/services/transcribe-service";
import { SAMPLE_RATE, pcm16ToFloat, splitAtPauses } from "@/lib/transcribe/audio";
import { clock, toCaptions, toSrt, toVtt, type TimedWord } from "@/lib/transcribe/captions";

/** A tone, with silence between `quiet` [start, end) second ranges. */
function audio(seconds: number, quiet: [number, number][] = []): Float32Array {
  const out = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SAMPLE_RATE;
    out[i] = quiet.some(([a, b]) => t >= a && t < b) ? 0 : 0.3 * Math.sin(t * 2 * Math.PI * 220);
  }
  return out;
}

describe("splitAtPauses", () => {
  it("keeps a short clip whole", () => {
    const pieces = splitAtPauses(audio(12));
    expect(pieces).toHaveLength(1);
    expect(pieces[0]!.offset).toBe(0);
  });

  it("cuts a long clip at the pause nearest the end of the window", () => {
    const pieces = splitAtPauses(audio(50, [[24, 24.4]]));
    expect(pieces).toHaveLength(2);
    expect(pieces[1]!.offset).toBeGreaterThanOrEqual(24);
    expect(pieces[1]!.offset).toBeLessThan(24.4);
    // Nothing lost or doubled between the pieces.
    expect(pieces[0]!.samples.length + pieces[1]!.samples.length).toBe(50 * SAMPLE_RATE);
  });

  it("never makes a piece longer than the window", () => {
    for (const piece of splitAtPauses(audio(95))) expect(piece.samples.length).toBeLessThanOrEqual(28 * SAMPLE_RATE);
  });

  it("skips pieces that are only silence", () => {
    const pieces = splitAtPauses(audio(40, [[0, 28]]));
    expect(pieces.every((p) => p.offset > 0)).toBe(true);
  });

  it("reads 16-bit little-endian PCM", () => {
    const bytes = new Uint8Array(new Int16Array([0, 16384, -32768]).buffer);
    expect([...pcm16ToFloat(bytes)]).toEqual([0, 0.5, -1]);
  });
});

const say = (text: string, start: number, length = 0.3): TimedWord[] =>
  text.split(" ").map((w, i) => ({ text: w, start: start + i * length, end: start + (i + 1) * length }));

describe("captions", () => {
  it("groups words into lines, breaking at sentence ends and pauses", () => {
    const words = [...say("What is the rarest monster? Nobody", 0), ...say("owns it.", 3)];
    expect(toCaptions(words, { maxWords: 6 }).map((c) => c.text)).toEqual(["What is the rarest monster?", "Nobody", "owns it."]);
  });

  it("does one word per caption for the pop-up style", () => {
    const captions = toCaptions(say("one two three", 0), { maxWords: 1 });
    expect(captions.map((c) => c.text)).toEqual(["one", "two", "three"]);
  });

  it("holds a caption until the next one starts across a short gap", () => {
    const captions = toCaptions([...say("first line.", 0), ...say("second", 0.8)], { maxWords: 6 });
    expect(captions[0]!.end).toBe(0.8);
  });

  it("writes SRT and VTT timestamps", () => {
    const captions = [{ start: 0.26, end: 3661.5, text: "Hi" }];
    expect(toSrt(captions)).toBe("1\n00:00:00,260 --> 01:01:01,500\nHi\n");
    expect(toVtt(captions)).toBe("WEBVTT\n\n00:00:00.260 --> 01:01:01.500\nHi\n");
  });

  it("formats clock times", () => {
    expect(clock(7)).toBe("0:07");
    expect(clock(125)).toBe("2:05");
    expect(clock(3727)).toBe("1:02:07");
  });
});

describe("TranscribeService", () => {
  const now = new Date("2026-10-22T15:00:00Z");

  function setup(usedSeconds = 0) {
    const recorded: { event_type: string; quantity?: number }[] = [];
    const calls: { language?: string }[] = [];
    const service = new TranscribeService({
      engine: {
        transcribe: async (_samples, options) => {
          calls.push(options ?? {});
          return { text: "hi", words: [{ text: "hi", start: 0, end: 0.3 }], seconds: 1 };
        },
      },
      usage: {
        userCountSince: async () => usedSeconds,
        record: async (event) => {
          recorded.push(event);
          return event as never;
        },
      },
    });
    return { service, recorded, calls };
  }

  it("transcribes and records the seconds", async () => {
    const { service, recorded, calls } = setup();
    await service.transcribe("u1", audio(30), "es", 20, now);
    expect(calls).toEqual([{ language: "es" }]);
    expect(recorded).toMatchObject([{ event_type: TRANSCRIBE_EVENT, quantity: 30 }]);
  });

  it("refuses past the daily minutes", async () => {
    const { service, calls } = setup(20 * 60 - 10);
    await expect(service.transcribe("u1", audio(30), "en", 20, now)).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    expect(calls).toHaveLength(0);
  });

  it("has no limit for the owner", async () => {
    const { service } = setup(99_999);
    await expect(service.transcribe("owner", audio(30), "en", null, now)).resolves.toMatchObject({ text: "hi" });
  });

  it("refuses files over five minutes", async () => {
    const { service } = setup();
    await expect(service.transcribe("u1", new Float32Array(302 * SAMPLE_RATE), "en", null, now)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("counts the day from midnight UTC", () => {
    expect(transcribeDayStart(now).toISOString()).toBe("2026-10-22T00:00:00.000Z");
  });
});
