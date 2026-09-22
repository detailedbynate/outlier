"use server";

import { revalidatePath } from "next/cache";
import { requireApprovedUser } from "@/lib/auth/session";
import { isAppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { DURATIONS, TONES, type Duration, type Tone } from "@/lib/scripts/schema";
import { getServices } from "@/lib/services";
import { asUser } from "@/lib/youtube/quota-context";
import { DEFAULT_SECONDS, DEFAULT_TONE, emptyScriptState, type ScriptState } from "./state";

const text = (value: FormDataEntryValue | null, max: number): string => String(value ?? "").trim().slice(0, max);

function duration(value: FormDataEntryValue | null): Duration {
  const seconds = Number(value);
  return (DURATIONS as readonly number[]).includes(seconds) ? (seconds as Duration) : DEFAULT_SECONDS;
}

function tone(value: FormDataEntryValue | null): Tone {
  const name = String(value ?? "");
  return (TONES as readonly string[]).includes(name) ? (name as Tone) : DEFAULT_TONE;
}

/**
 * Write one Short script.
 *
 * Owner-only while the writer is still being judged on real output. The check is
 * here as well as in the page because a server action is a public endpoint: the
 * page deciding not to render the form is a UI choice, not access control.
 */
export async function writeScript(_previous: ScriptState, formData: FormData): Promise<ScriptState> {
  const current = await requireApprovedUser();
  const sent = {
    topic: text(formData.get("topic"), 80),
    idea: text(formData.get("idea"), 200),
    angle: text(formData.get("angle"), 300),
    seconds: duration(formData.get("seconds")),
    tone: tone(formData.get("tone")),
  };

  if (!current.isOwner) return { ...emptyScriptState, sent, error: "The script writer isn't open yet." };
  if (!sent.topic) return { ...emptyScriptState, sent, error: "Pick a niche to write for." };
  if (!sent.idea) return { ...emptyScriptState, sent, error: "Say what the Short should be about." };

  const services = getServices();
  try {
    // Charged up front so a script can't be generated on an empty balance, and
    // charged again only on success — a failed generation costs nothing.
    await services.credits.assertAvailable(current.user.id, "write_script");
    const result = await asUser(current.user.id, "action:write_script", () =>
      services.scripts.write({ topic: sent.topic, idea: sent.idea, angle: sent.angle || undefined, targetSeconds: sent.seconds, tone: sent.tone }),
    );
    const { charged } = await services.credits.charge(current.user.id, "write_script");
    // Refreshes the sidebar credits meter.
    revalidatePath("/", "layout");
    return { result, error: null, charged, sent };
  } catch (error) {
    logger.warn("script writing failed", { topic: sent.topic, error });
    return {
      ...emptyScriptState,
      sent,
      error: isAppError(error) && error.expose ? error.message : "Couldn't write that one. Try again in a moment.",
    };
  }
}
