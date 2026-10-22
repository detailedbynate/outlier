/** One spoken word and when it's said, in seconds. */
export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

export interface Caption {
  start: number;
  end: number;
  text: string;
}

/** A pause this long ends a caption even when there's room for more words. */
const PAUSE_SECONDS = 0.6;

/**
 * Group words into on-screen captions: at most `maxWords` and `maxSeconds`
 * each, and a new one after a sentence ends or the speaker pauses. One word
 * per caption is the pop-up style Shorts editors animate.
 */
export function toCaptions(words: readonly TimedWord[], options: { maxWords?: number; maxSeconds?: number } = {}): Caption[] {
  const maxWords = Math.max(1, Math.floor(options.maxWords ?? 6));
  const maxSeconds = options.maxSeconds ?? 3;
  const captions: Caption[] = [];
  let line: TimedWord[] = [];
  const flush = () => {
    if (line.length === 0) return;
    captions.push({ start: line[0]!.start, end: line[line.length - 1]!.end, text: line.map((w) => w.text.trim()).join(" ") });
    line = [];
  };
  for (const word of words) {
    if (!word.text.trim()) continue;
    const last = line[line.length - 1];
    if (last && (line.length >= maxWords || word.end - line[0]!.start > maxSeconds || word.start - last.end >= PAUSE_SECONDS || /[.!?]["')\]]*$/.test(last.text.trim()))) {
      flush();
    }
    line.push(word);
  }
  flush();
  // Each caption stays up until the next one starts, so the screen never flashes empty mid-sentence.
  for (let i = 0; i < captions.length - 1; i += 1) {
    const gap = captions[i + 1]!.start - captions[i]!.end;
    if (gap > 0 && gap < PAUSE_SECONDS) captions[i]!.end = captions[i + 1]!.start;
  }
  return captions;
}

function stamp(seconds: number, separator: "," | "."): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${separator}${pad(ms % 1000, 3)}`;
}

/** SubRip, what CapCut, Premiere and YouTube Studio all import. */
export function toSrt(captions: readonly Caption[]): string {
  return captions.map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${c.text}\n`).join("\n");
}

export function toVtt(captions: readonly Caption[]): string {
  return `WEBVTT\n\n${captions.map((c) => `${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${c.text}\n`).join("\n")}`;
}

/** "0:07" or "1:02:07", for the transcript view. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(s / 60) % 60;
  const ss = String(s % 60).padStart(2, "0");
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}
