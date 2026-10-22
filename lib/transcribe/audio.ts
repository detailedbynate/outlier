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

/** 16-bit PCM, as the browser uploads it, back to the floats Whisper takes. */
export function pcm16ToFloat(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength - (bytes.byteLength % 2));
  const out = new Float32Array(view.byteLength / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}
