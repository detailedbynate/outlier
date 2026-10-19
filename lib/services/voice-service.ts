import { AppError, ValidationError } from "@/lib/core/errors";
import { createLogger } from "@/lib/core/logger";
import type { UsageRepository } from "@/lib/database/repositories/usage";
import type { ElevenLabsClient, Voice, VoiceSettings } from "@/lib/voice/elevenlabs";

const log = createLogger({ module: "voice" });

/** usage_events type for ElevenLabs use; quantity is the credits ElevenLabs charged. */
export const VOICE_CREDITS_EVENT = "voice.credits";

/** usage_events type for each person's monthly allowance; quantity is the characters read out. */
export const VOICE_CHARACTERS_EVENT = "voice.characters";

/**
 * Longest text one generation takes: about a minute read out, twice a 30s
 * Short. It keeps every generation one flat price, and a long piece can still
 * be done in parts.
 */
export const VOICE_MAX_CHARACTERS = 1_000;

/**
 * The cap is counted over the last 30 days rather than the calendar month.
 * ElevenLabs' month starts on the day you subscribed, so a calendar month
 * could let two lots of the share land inside one of their billing months.
 */
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Credits per character to assume before ElevenLabs says what a clip cost.
 * v4 Turbo measured about 0.22; the guess stays high so the cap is never overshot.
 */
const ESTIMATE_PER_CHARACTER = 0.5;

/** The voice list barely changes, so it's fetched once an hour rather than on every page load. */
const VOICES_TTL_MS = 60 * 60 * 1000;

/** Allowances reset on the 1st of each month (UTC). */
export function voiceMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** When this month's allowance resets, e.g. "Nov 1". */
export function voiceResetLabel(now: Date): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

const clamp =(value: number, min: number, max: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback;

/** Whatever the browser sent, made into settings ElevenLabs accepts. */
export function cleanSettings(raw: Partial<Record<keyof VoiceSettings, unknown>>): VoiceSettings {
  return {
    stability: clamp(Number(raw.stability), 0, 1, 0.5),
    style: clamp(Number(raw.style), 0, 1, 0),
    speed: clamp(Number(raw.speed), 0.7, 1.2, 1),
  };
}

/**
 * Voice Studio: text read out by ElevenLabs' stock voices.
 *
 * Every call spends credits on the owner's ElevenLabs plan. Each person gets a
 * monthly allowance of characters rather than paying Outlier credits
 * (ElevenLabs bills by the character, so the allowance tracks the real cost),
 * and there's one cap for the whole app: a share of the plan's credits in any
 * 30 days, counted from what ElevenLabs reports.
 */
export class VoiceService {
  private voiceCache: { at: number; voices: Voice[] } | null = null;

  constructor(
    private readonly deps: {
      client: Pick<ElevenLabsClient, "listVoices" | "speak" | "model"> | null;
      usage: Pick<UsageRepository, "countSince" | "userCountSince" | "record">;
      /** Most ElevenLabs credits the whole app may use in any 30 days. */
      creditCap: number;
    },
  ) {}

  get enabled(): boolean {
    return this.deps.client !== null && this.deps.creditCap > 0;
  }

  get model(): string | null {
    return this.deps.client?.model ?? null;
  }

  /** The stock voices to pick from; empty when ElevenLabs isn't set up or can't be reached. */
  async voices(now: number = Date.now()): Promise<Voice[]> {
    if (!this.deps.client) return [];
    if (this.voiceCache && now - this.voiceCache.at < VOICES_TTL_MS) return this.voiceCache.voices;
    try {
      const voices = await this.deps.client.listVoices(AbortSignal.timeout(8_000));
      this.voiceCache = { at: now, voices };
      return voices;
    } catch (error) {
      log.warn("could not list elevenlabs voices", { error });
      // A stale list beats no picker.
      return this.voiceCache?.voices ?? [];
    }
  }

  /** Characters this person has had read out since the 1st. */
  async charactersUsed(userId: string, now: Date = new Date()): Promise<number> {
    return this.deps.usage.userCountSince(userId, VOICE_CHARACTERS_EVENT, voiceMonthStart(now));
  }

  /**
   * Read the text out. Returns MP3 bytes. `allowance` is the characters this
   * person may use a month, or null for no limit (the owner).
   */
  async speak(userId: string, rawText: string, voiceId: string, settings: VoiceSettings, allowance: number | null, now: Date = new Date()): Promise<{ audio: Uint8Array; characters: number }> {
    const client = this.deps.client;
    if (!client || !this.enabled) throw new AppError("NOT_IMPLEMENTED", "Voice Studio isn't switched on yet.", { expose: true });

    const text = rawText.replace(/\s+/g, " ").trim();
    if (!text) throw new ValidationError("Type something for the voice to say.");
    if (text.length > VOICE_MAX_CHARACTERS) throw new ValidationError(`That's ${text.length.toLocaleString("en-US")} characters. One go takes up to ${VOICE_MAX_CHARACTERS.toLocaleString("en-US")}, so split it in two.`);

    const voices = await this.voices(now.getTime());
    if (!voices.some((v) => v.id === voiceId)) throw new ValidationError("Pick one of the voices in the list.");

    if (allowance !== null) {
      const left = Math.max(0, allowance - (await this.charactersUsed(userId, now)));
      if (text.length > left) {
        const fmt = (n: number) => n.toLocaleString("en-US");
        throw new AppError(
          "QUOTA_EXCEEDED",
          left === 0
            ? `You've used all ${fmt(allowance)} characters for this month. They reset on ${voiceResetLabel(now)}.`
            : `That's ${fmt(text.length)} characters and you have ${fmt(left)} left this month. Shorten it, or wait until ${voiceResetLabel(now)}.`,
          { expose: true },
        );
      }
    }

    const estimate = Math.ceil(text.length * ESTIMATE_PER_CHARACTER);
    const used = await this.deps.usage.countSince(VOICE_CREDITS_EVENT, new Date(now.getTime() - WINDOW_MS));
    if (used + estimate > this.deps.creditCap) {
      throw new AppError("QUOTA_EXCEEDED", "Voice Studio has hit its limit for now across Outlier. It frees up again over the next few days.", { expose: true });
    }

    const { audio, credits } = await client.speak(voiceId, text, settings, AbortSignal.timeout(45_000));
    // Recorded separately so one failing doesn't lose the other. The audio
    // already came back; losing a line of accounting beats failing the request.
    const recorded = await Promise.allSettled([
      this.deps.usage.record({ event_type: VOICE_CHARACTERS_EVENT, user_id: userId, quantity: text.length, resource_id: voiceId, occurred_at: now.toISOString() }),
      this.deps.usage.record({ event_type: VOICE_CREDITS_EVENT, user_id: userId, quantity: Math.max(1, Math.ceil(credits ?? estimate)), resource_id: voiceId, occurred_at: now.toISOString() }),
    ]);
    for (const result of recorded) {
      if (result.status === "rejected") log.warn("could not record voice usage", { error: result.reason });
    }
    return { audio, characters: text.length };
  }
}
