/** Whisper hears 16 kHz mono; the browser resamples to this before uploading. */
export const SAMPLE_RATE = 16_000;

/** Whisper's window is 30s. Pieces stay under it so none gets cut mid-word. */
const MAX_PIECE_SECONDS = 28;

/** Look this far back from a piece's end for the quietest moment to cut at. */
const SEARCH_SECONDS = 8;

/** Loudness is measured over 20ms frames. */
const FRAME = SAMPLE_RATE / 50;

/** Quieter than this (RMS) throughout and a piece is skipped: Whisper invents words over silence. */
const SILENT_RMS = 0.004;

export interface AudioPiece {
  /** Where the piece starts in the whole recording, in seconds. */
  offset: number;
  samples: Float32Array;
}

function rms(samples: Float32Array, start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i += 1) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / Math.max(1, end - start));
}

/**
 * Cut a recording into pieces Whisper can take one at a time, each cut made at
 * the quietest 20ms near the end of the window, between words rather than
 * through one. Transformers.js' own chunking overlaps windows and merges them
 * back, and on a 30s voiceover it read the last sentence out twice.
 */
export function splitAtPauses(samples: Float32Array, maxSeconds = MAX_PIECE_SECONDS): AudioPiece[] {
  const max = Math.floor(maxSeconds * SAMPLE_RATE);
  const search = Math.min(Math.floor(SEARCH_SECONDS * SAMPLE_RATE), Math.floor(max / 2));
  const pieces: AudioPiece[] = [];
  let start = 0;
  while (start < samples.length) {
    let end = Math.min(start + max, samples.length);
    if (end < samples.length) {
      let quietest = Infinity;
      for (let at = end - FRAME; at >= end - search; at -= FRAME) {
        const level = rms(samples, at, at + FRAME);
        if (level < quietest) {
          quietest = level;
          end = at + FRAME / 2;
        }
      }
    }
    const piece = samples.subarray(start, end);
    if (rms(piece, 0, piece.length) >= SILENT_RMS) pieces.push({ offset: start / SAMPLE_RATE, samples: piece });
    start = end;
  }
  return pieces;
}

/** Loudness frames for snapping words to the audio: 10ms. */
const SNAP_FRAME = SAMPLE_RATE / 100;

/** How far back from Whisper's start to look for where the word's sound begins. */
const SNAP_BACK_SECONDS = 0.5;

/** Quiet this long (50ms) before a rise marks a word starting; shorter dips are inside a word. */
const SNAP_GAP_FRAMES = 5;

/**
 * Whisper's start when no clear onset is found, pulled back by this much: in
 * runs of speech with no dip between words it lands about this late.
 */
const SNAP_LEAD_SECONDS = 0.12;

/**
 * Whisper base reads word times off its attention, and they run late: words
 * start 0.1-0.3s after the voice does, and a word before a pause is held up
 * to 0.7s into the silence after it. On screen the captions trail the
 * voiceover. This moves each start back to where the sound actually rises
 * and trims each end to where it falls, never crossing a neighbouring word.
 */
export function snapToAudio<T extends { start: number; end: number }>(samples: Float32Array, words: readonly T[]): T[] {
  const frames = Math.floor(samples.length / SNAP_FRAME);
  if (frames === 0 || words.length === 0) return [...words];
  const level = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) level[f] = rms(samples, f * SNAP_FRAME, (f + 1) * SNAP_FRAME);
  // Quiet is relative to how loud this recording's speech is, so background hiss doesn't count as a word.
  const sorted = Float32Array.from(level).sort();
  const quiet = Math.max(SILENT_RMS, sorted[Math.floor(frames * 0.95)]! * 0.1);
  const frameAt = (seconds: number) => Math.min(frames - 1, Math.max(0, Math.round((seconds * SAMPLE_RATE) / SNAP_FRAME)));
  const timeOf = (frame: number) => (frame * SNAP_FRAME) / SAMPLE_RATE;

  const out = words.map((w) => ({ ...w }));
  for (let i = 0; i < out.length; i += 1) {
    const word = out[i]!;
    const floor = i > 0 ? out[i - 1]!.start + 0.05 : 0;
    const from = frameAt(word.start);
    const limit = frameAt(Math.max(floor, word.start - SNAP_BACK_SECONDS));
    // The sound rising after a real gap, not a dip inside a word ("Ap-ple").
    let onset = -1;
    for (let f = from; f > limit && onset < 0; f -= 1) {
      if (level[f]! < quiet) continue;
      let gap = 0;
      while (gap < SNAP_GAP_FRAMES && f - gap - 1 >= 0 && level[f - gap - 1]! < quiet) gap += 1;
      if (gap >= SNAP_GAP_FRAMES || (gap > 0 && f - gap === 0)) onset = f;
    }
    const start = onset >= 0 ? timeOf(onset) : word.start - SNAP_LEAD_SECONDS;
    word.start = Math.max(floor, Math.min(start, word.end - 0.05));

    // Trim trailing silence: back from the end to the last loud frame, keeping a little tail.
    let last = frameAt(word.end) - 1;
    const first = frameAt(word.start);
    while (last > first && level[last]! < quiet) last -= 1;
    if (last > first) word.end = Math.min(word.end, timeOf(last + 1) + 0.08);
    if (i > 0 && out[i - 1]!.end > word.start) out[i - 1]!.end = word.start;
  }
  return out;
}

/** 16-bit PCM, as the browser uploads it, back to the floats Whisper takes. */
export function pcm16ToFloat(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength - (bytes.byteLength % 2));
  const out = new Float32Array(view.byteLength / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}
