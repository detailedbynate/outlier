import { AppError, ValidationError } from "@/lib/core/errors";
import { createLogger } from "@/lib/core/logger";
import type { UsageRepository } from "@/lib/database/repositories/usage";
import { SAMPLE_RATE } from "@/lib/transcribe/audio";
import { TRANSCRIBE_MAX_SECONDS, type TranscribeLanguage } from "@/lib/transcribe/languages";
import type { Transcript, WhisperEngine } from "@/lib/transcribe/whisper";

const log = createLogger({ module: "transcribe" });

/** usage_events type for each transcription; quantity is the seconds of audio. */
export const TRANSCRIBE_EVENT = "transcribe.seconds";

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
      engine: Pick<WhisperEngine, "transcribe">;
      usage: Pick<UsageRepository, "userCountSince" | "record">;
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
}
