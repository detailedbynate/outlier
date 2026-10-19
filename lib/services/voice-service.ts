import { AppError, ValidationError } from "@/lib/core/errors";
import { createLogger } from "@/lib/core/logger";
import type { UsageRepository } from "@/lib/database/repositories/usage";
import type { ElevenLabsClient, Voice, VoiceSettings } from "@/lib/voice/elevenlabs";

const log = createLogger({ module: "voice" });

/** usage_events type for ElevenLabs use; quantity is the credits ElevenLabs charged. */
export const VOICE_CREDITS_EVENT = "voice.credits";

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

const clamp = (value: number, min: number, max: number, fallback: number): number =>
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
 * Every call spends credits on the owner's ElevenLabs plan, so besides each
 * person's credits and daily limit there's one cap for the whole app: a share
 * of the plan's credits in any 30 days, counted from what ElevenLabs reports.
 */
export class VoiceService {
  private voiceCache: { at: number; voices: Voice[] } | null = null;

  constructor(
    private readonly deps: {
      client: Pick<ElevenLabsClient, "listVoices" | "speak" | "model"> | null;
      usage: Pick<UsageRepository, "countSince" | "record">;
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

  /** Read the text out. Returns MP3 bytes. */
  async speak(userId: string, rawText: string, voiceId: string, settings: VoiceSettings, now: Date = new Date()): Promise<{ audio: Uint8Array; characters: number }> {
    const client = this.deps.client;
    if (!client || !this.enabled) throw new AppError("NOT_IMPLEMENTED", "Voice Studio isn't switched on yet.", { expose: true });

    const text = rawText.replace(/\s+/g, " ").trim();
    if (!text) throw new ValidationError("Type something for the voice to say.");
    if (text.length > VOICE_MAX_CHARACTERS) throw new ValidationError(`That's ${text.length.toLocaleString("en-US")} characters. One go takes up to ${VOICE_MAX_CHARACTERS.toLocaleString("en-US")}, so split it in two.`);

    const voices = await this.voices(now.getTime());
    if (!voices.some((v) => v.id === voiceId)) throw new ValidationError("Pick one of the voices in the list.");

    const estimate = Math.ceil(text.length * ESTIMATE_PER_CHARACTER);
    const used = await this.deps.usage.countSince(VOICE_CREDITS_EVENT, new Date(now.getTime() - WINDOW_MS));
    if (used + estimate > this.deps.creditCap) {
      throw new AppError("QUOTA_EXCEEDED", "Voice Studio has hit its limit for now across Outlier. It frees up again over the next few days.", { expose: true });
    }

    const { audio, credits } = await client.speak(voiceId, text, settings, AbortSignal.timeout(45_000));
    try {
      await this.deps.usage.record({ event_type: VOICE_CREDITS_EVENT, user_id: userId, quantity: Math.max(1, Math.ceil(credits ?? estimate)), resource_id: voiceId, occurred_at: now.toISOString() });
    } catch (error) {
      // The audio already came back; losing one line of accounting beats failing the request.
      log.warn("could not record voice usage", { error });
    }
    return { audio, characters: text.length };
  }
}
