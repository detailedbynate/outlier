import { join } from "node:path";
import { AppError } from "@/lib/core/errors";
import { createLogger } from "@/lib/core/logger";
import { SAMPLE_RATE, splitAtPauses } from "./audio";
import type { TimedWord } from "./captions";

const log = createLogger({ module: "transcribe.whisper" });

/**
 * Whisper base, run on the server's own CPU: nothing to pay per use. Measured
 * 30s of voiceover in ~6s and ~0.9 GB; small read the same test no better in
 * 15s and 1.6 GB, too much next to the app under its 3 GB limit. The
 * `_timestamped` export carries the attention needed for word timings.
 */
const MODEL = "onnx-community/whisper-base_timestamped";

/** Half the box's six cores: the site, the scraper and Postgres keep the rest. */
const THREADS = 3;

/** Let the model go after this long unused, giving its memory back. */
const IDLE_UNLOAD_MS = 20 * 60_000;

/** Files waiting behind the one being read; past this people are told to try again shortly. */
const MAX_WAITING = 4;

interface WordChunk {
  text: string;
  timestamp: [number, number | null];
}

type Recognizer = ((audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string; chunks?: WordChunk[] }>) & {
  dispose(): Promise<void>;
};

export interface Transcript {
  text: string;
  words: TimedWord[];
  seconds: number;
}

/**
 * One file at a time, the model loaded on first use. A second file waits its
 * turn rather than running alongside: two at once would take as long in total
 * and double the memory.
 */
export class WhisperEngine {
  private recognizer: Promise<Recognizer> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private waiting = 0;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(private readonly cacheDir: string = process.env.WHISPER_CACHE_DIR ?? join(process.cwd(), ".cache", "whisper")) {}

  /** How many files are ahead of a new one. */
  get busy(): number {
    return this.waiting;
  }

  async transcribe(samples: Float32Array, options: { language?: string } = {}): Promise<Transcript> {
    if (this.waiting > MAX_WAITING) {
      throw new AppError("RATE_LIMITED", "A lot of people are transcribing right now. Try again in a minute.", { expose: true, retryable: true });
    }
    this.waiting += 1;
    const run = this.queue.then(() => this.read(samples, options));
    this.queue = run.catch(() => {});
    try {
      return await run;
    } finally {
      this.waiting -= 1;
      this.scheduleUnload();
    }
  }

  private async read(samples: Float32Array, { language }: { language?: string }): Promise<Transcript> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const recognize = await this.load();
    const started = Date.now();
    const words: TimedWord[] = [];
    const text: string[] = [];
    for (const piece of splitAtPauses(samples)) {
      const out = await recognize(piece.samples, { return_timestamps: "word", ...(language ? { language, task: "transcribe" } : {}) });
      const end = piece.offset + piece.samples.length / SAMPLE_RATE;
      for (const chunk of out.chunks ?? []) {
        const [from, to] = chunk.timestamp;
        const start = piece.offset + (from ?? 0);
        words.push({ text: chunk.text.trim(), start, end: Math.min(to === null ? end : piece.offset + to, end) });
      }
      if (out.text.trim()) text.push(out.text.trim());
    }
    const seconds = samples.length / SAMPLE_RATE;
    log.info("transcribed", { seconds: Math.round(seconds), took: Date.now() - started, words: words.length });
    return { text: text.join(" "), words: words.filter((w) => w.text), seconds };
  }

  private load(): Promise<Recognizer> {
    this.recognizer ??= (async () => {
      const started = Date.now();
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = this.cacheDir;
      const recognizer = (await pipeline("automatic-speech-recognition", MODEL, {
        dtype: "q8",
        session_options: { intraOpNumThreads: THREADS, interOpNumThreads: 1 },
      })) as unknown as Recognizer;
      log.info("whisper loaded", { model: MODEL, took: Date.now() - started });
      return recognizer;
    })().catch((error: unknown) => {
      this.recognizer = null;
      log.error("whisper failed to load", { error });
      throw new AppError("UPSTREAM_ERROR", "Transcription isn't available right now. Try again in a few minutes.", { expose: true, retryable: true, cause: error });
    });
    return this.recognizer;
  }

  private scheduleUnload(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.waiting > 0 || !this.recognizer) return;
    this.idleTimer = setTimeout(() => {
      const loaded = this.recognizer;
      if (!loaded || this.waiting > 0) return;
      this.recognizer = null;
      void loaded.then((r) => r.dispose()).catch(() => {});
      log.info("whisper unloaded after idle");
    }, IDLE_UNLOAD_MS);
    this.idleTimer.unref();
  }
}
