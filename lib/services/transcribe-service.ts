import { AppError, ValidationError } from "@/lib/core/errors";
import { createLogger } from "@/lib/core/logger";
import type { UsageRepository } from "@/lib/database/repositories/usage";
import { SAMPLE_RATE } from "@/lib/transcribe/audio";
import { TRANSCRIBE_MAX_SECONDS, type TranscribeLanguage } from "@/lib/transcribe/languages";
import type { Transcript, WhisperEngine } from "@/lib/transcribe/whisper";

const log = createLogger({ module: "transcribe" });

/** usage_events type for each transcription; quantity is the seconds of audio. */
export const TRANSCRIBE_EVENT = "transcribe.seconds";

/** usage_events type for the free public caption tool (no user); quantity is seconds. */
export const FREE_TRANSCRIBE_EVENT = "transcribe.free_seconds";

/** The free tool takes one short clip at a time. */
export const FREE_TRANSCRIBE_MAX_SECONDS = 60;

/** All free use together, per UTC day: an hour of audio is ~12 minutes of CPU. */
export const FREE_TRANSCRIBE_DAILY_SECONDS = 60 * 60;

/** Allowances reset at midnight UTC. */
export function transcribeDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Audio to text with word timings, for captions. Whisper runs on Outlier's own
 * server, so a transcription costs nothing but CPU time; the daily allowance
 * (minutes of audio) is there so one person can't keep the queue full.
 */
export class TranscribeService {
  constructor(
    private readonly deps: {
      engine: Pick<WhisperEngine, "transcribe"> & Partial<Pick<WhisperEngine, "busy">>;
      usage: Pick<UsageRepository, "userCountSince" | "record"> & Partial<Pick<UsageRepository, "countSince">>;
    },
  ) {}

  /** Seconds of audio this person has transcribed today. */
  async secondsUsed(userId: string, now: Date = new Date()): Promise<number> {
    return this.deps.usage.userCountSince(userId, TRANSCRIBE_EVENT, transcribeDayStart(now));
  }

  /** `allowance` is minutes a day, or null for no limit (the owner). */
  async transcribe(userId: string, samples: Float32Array, language: TranscribeLanguage, allowance: number | null, now: Date = new Date()): Promise<Transcript> {
    const seconds = samples.length / SAMPLE_RATE;
    if (seconds < 0.5) throw new ValidationError("That file has no audio in it.");
    if (seconds > TRANSCRIBE_MAX_SECONDS + 1) throw new ValidationError(`Keep it under ${TRANSCRIBE_MAX_SECONDS / 60} minutes for one go.`);

    if (allowance !== null) {
      const left = allowance * 60 - (await this.secondsUsed(userId, now));
      if (seconds > left) {
        throw new AppError(
          "QUOTA_EXCEEDED",
          left < 1
            ? `You've used today's ${allowance} minutes of transcription. It resets at midnight UTC.`
            : `That's ${Math.ceil(seconds / 60)} minutes and you have ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, "0")} left today.`,
          { expose: true },
        );
      }
    }

    const transcript = await this.deps.engine.transcribe(samples, { language });
    await this.deps.usage
      .record({ event_type: TRANSCRIBE_EVENT, user_id: userId, quantity: Math.max(1, Math.round(seconds)), resource_id: language, occurred_at: now.toISOString() })
      .catch((error: unknown) => log.warn("could not record transcription usage", { error }));
    return transcript;
  }

  /**
   * The free public caption tool. It only runs when nobody else is being
   * transcribed, so paying members never wait behind a free file, and all free
   * use shares one daily budget. The per-visitor limit is the route's job.
   */
  async transcribeFree(samples: Float32Array, language: TranscribeLanguage, now: Date = new Date()): Promise<Transcript> {
    const seconds = samples.length / SAMPLE_RATE;
    if (seconds < 0.5) throw new ValidationError("That file has no audio in it.");
    if (seconds > FREE_TRANSCRIBE_MAX_SECONDS + 1) throw new ValidationError(`The free tool takes up to ${FREE_TRANSCRIBE_MAX_SECONDS} seconds. Trim it, or use Outlier for up to 5 minutes a file.`);
    if ((this.deps.engine.busy ?? 0) > 0) {
      throw new AppError("RATE_LIMITED", "The free tool is busy right now. Try again in a minute.", { expose: true, retryable: true });
    }
    const usedToday = (await this.deps.usage.countSince?.(FREE_TRANSCRIBE_EVENT, transcribeDayStart(now)).catch(() => 0)) ?? 0;
    if (usedToday + seconds > FREE_TRANSCRIBE_DAILY_SECONDS) {
      throw new AppError("RATE_LIMITED", "The free tool has hit today's limit. It resets at midnight UTC.", { expose: true });
    }

    const transcript = await this.deps.engine.transcribe(samples, { language });
    await this.deps.usage
      .record({ event_type: FREE_TRANSCRIBE_EVENT, quantity: Math.max(1, Math.round(seconds)), resource_id: language, occurred_at: now.toISOString() })
      .catch((error: unknown) => log.warn("could not record free transcription usage", { error }));
    return transcript;
  }
}
