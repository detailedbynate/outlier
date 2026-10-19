import { AppError, NotFoundError } from "@/lib/core/errors";
import { createLogger } from "@/lib/core/logger";
import type { SavedScriptRepository } from "@/lib/database/repositories/saved-scripts";
import type { UsageRepository } from "@/lib/database/repositories/usage";
import { scriptText } from "@/lib/scripts/schema";
import type { ElevenLabsClient, Voice } from "@/lib/voice/elevenlabs";
import { startOfUtcMonth } from "./credits-service";

const log = createLogger({ module: "voice" });

/** usage_events type for ElevenLabs use; quantity is characters sent. */
export const VOICE_CHARACTERS_EVENT = "voice.characters";

/** The voice list barely changes, so it's fetched once an hour rather than on every page load. */
const VOICES_TTL_MS = 60 * 60 * 1000;

/**
 * Voiceovers for scripts people have written.
 *
 * Only a saved script can be voiced, looked up by id under the person's own
 * account. Taking text from the browser instead would make this a free
 * text-to-speech box for anything at all, on the owner's ElevenLabs plan.
 */
export class VoiceService {
  private voiceCache: { at: number; voices: Voice[] } | null = null;

  constructor(
    private readonly deps: {
      client: Pick<ElevenLabsClient, "listVoices" | "speak"> | null;
      scripts: Pick<SavedScriptRepository, "getForUser">;
      usage: Pick<UsageRepository, "countSince" | "record">;
      /** Most characters the whole app sends ElevenLabs per UTC month, kept under the plan's allowance. */
      monthlyCharacters: number;
    },
  ) {}

  get enabled(): boolean {
    return this.deps.client !== null && this.deps.monthlyCharacters > 0;
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

  /** Read one of their scripts out loud. Returns MP3 bytes. */
  async voiceover(userId: string, scriptId: string, voiceId: string, now: Date = new Date()): Promise<{ audio: Uint8Array; characters: number }> {
    const client = this.deps.client;
    if (!client || !this.enabled) throw new AppError("NOT_IMPLEMENTED", "Voiceovers aren't switched on yet.", { expose: true });

    const voices = await this.voices(now.getTime());
    if (!voices.some((v) => v.id === voiceId)) throw new AppError("VALIDATION_ERROR", "Pick one of the voices in the list.");

    const row = await this.deps.scripts.getForUser(userId, scriptId);
    if (!row) throw new NotFoundError("Script");
    const text = scriptText(row.script);

    const used = await this.deps.usage.countSince(VOICE_CHARACTERS_EVENT, startOfUtcMonth(now));
    if (used + text.length > this.deps.monthlyCharacters) {
      throw new AppError("QUOTA_EXCEEDED", "Voiceovers are used up for this month across Outlier. They come back on the 1st.", { expose: true });
    }

    const audio = await client.speak(voiceId, text, AbortSignal.timeout(45_000));
    try {
      await this.deps.usage.record({ event_type: VOICE_CHARACTERS_EVENT, user_id: userId, quantity: text.length, resource_id: scriptId, occurred_at: now.toISOString() });
    } catch (error) {
      // The audio already came back; losing one line of accounting beats failing the request.
      log.warn("could not record voice usage", { error });
    }
    return { audio, characters: text.length };
  }
}
