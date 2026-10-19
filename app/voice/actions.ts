"use server";

import { requireApprovedUser } from "@/lib/auth/session";
import { isAppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { writerAccess } from "@/lib/scripts/access";
import { getServices } from "@/lib/services";
import { VOICE_MAX_CHARACTERS, cleanSettings } from "@/lib/services/voice-service";

export interface GenerateResult {
  /** The MP3 as base64, so the browser can play and download it without a second request. */
  audio: string | null;
  error: string | null;
  characters: number;
  /** Characters used this month, counting this one, for the allowance meter. */
  used: number | null;
}

/**
 * Read text out with one of the stock voices. Open to the plans the Script
 * Writer is on. It costs no Outlier credits: each plan gets a monthly
 * allowance of characters instead, used only when audio comes back.
 */
export async function generateVoice(input: { text: string; voiceId: string; stability: number; style: number; speed: number }): Promise<GenerateResult> {
  const current = await requireApprovedUser();
  const access = await writerAccess(current);
  if (!access) return { audio: null, error: "Voice Studio is on the Pro and Expert plans.", characters: 0, used: null };

  const text = String(input.text ?? "").slice(0, 5_000);
  const voiceId = String(input.voiceId ?? "").slice(0, 40);
  const length = text.replace(/\s+/g, " ").trim().length;
  if (!length) return { audio: null, error: "Type something for the voice to say.", characters: 0, used: null };
  if (length > VOICE_MAX_CHARACTERS) return { audio: null, error: `Keep it under ${VOICE_MAX_CHARACTERS.toLocaleString("en-US")} characters for one go.`, characters: 0, used: null };

  const services = getServices();
  try {
    const { audio, characters } = await services.voice.speak(current.user.id, text, voiceId, cleanSettings(input), access.voiceCharacters);
    const used = await services.voice.charactersUsed(current.user.id).catch(() => null);
    return { audio: Buffer.from(audio).toString("base64"), error: null, characters, used };
  } catch (error) {
    logger.warn("voice generation failed", { voiceId, error });
    return {
      audio: null,
      error: isAppError(error) && error.expose ? error.message : "Couldn't make that one. Try again in a moment.",
      characters: 0,
      used: null,
    };
  }
}
