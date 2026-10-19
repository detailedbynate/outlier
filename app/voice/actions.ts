"use server";

import { revalidatePath } from "next/cache";
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
  charged: number;
  characters: number;
}

/**
 * Read text out with one of the stock voices. Open to the plans the Script
 * Writer is on; charged only when audio comes back.
 */
export async function generateVoice(input: { text: string; voiceId: string; stability: number; style: number; speed: number }): Promise<GenerateResult> {
  const current = await requireApprovedUser();
  const access = await writerAccess(current);
  if (!access) return { audio: null, error: "Voice Studio is on the Pro and Expert plans.", charged: 0, characters: 0 };

  const text = String(input.text ?? "").slice(0, 5_000);
  const voiceId = String(input.voiceId ?? "").slice(0, 40);
  // Checked before the daily limit so a typo doesn't use up a go.
  const length = text.replace(/\s+/g, " ").trim().length;
  if (!length) return { audio: null, error: "Type something for the voice to say.", charged: 0, characters: 0 };
  if (length > VOICE_MAX_CHARACTERS) return { audio: null, error: `Keep it under ${VOICE_MAX_CHARACTERS.toLocaleString("en-US")} characters for one go.`, charged: 0, characters: 0 };

  const services = getServices();
  try {
    await services.credits.assertAvailable(current.user.id, "voiceover");
    if (access.voiceLimit) await services.rateLimits.enforce(access.voiceLimit, current.user.id);
    const { audio, characters } = await services.voice.speak(current.user.id, text, voiceId, cleanSettings(input));
    const { charged } = await services.credits.charge(current.user.id, "voiceover");
    revalidatePath("/", "layout");
    return { audio: Buffer.from(audio).toString("base64"), error: null, charged, characters };
  } catch (error) {
    logger.warn("voice generation failed", { voiceId, error });
    return {
      audio: null,
      error: isAppError(error) && (error.expose || error.code === "RATE_LIMITED") ? error.message : "Couldn't make that one. Try again in a moment.",
      charged: 0,
      characters: 0,
    };
  }
}
