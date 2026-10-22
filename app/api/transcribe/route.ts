import { getCurrentUser } from "@/lib/auth/session";
import { isAppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { writerAccess } from "@/lib/scripts/access";
import { getServices } from "@/lib/services";
import { SAMPLE_RATE, pcm16ToFloat } from "@/lib/transcribe/audio";
import { TRANSCRIBE_MAX_SECONDS, isTranscribeLanguage } from "@/lib/transcribe/languages";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 16-bit samples: two bytes each, plus a little slack for a file a hair over the limit. */
const MAX_BYTES = (TRANSCRIBE_MAX_SECONDS + 5) * SAMPLE_RATE * 2;

const fail = (status: number, error: string) => Response.json({ error }, { status });

/**
 * POST /api/transcribe?language=en — the body is the recording as 16 kHz mono
 * 16-bit PCM. The browser decodes the mp3 (or wav, m4a…) itself, so the server
 * needs no ffmpeg and uploads stay small: a minute is under 2 MB.
 */
export async function POST(request: Request): Promise<Response> {
  const current = await getCurrentUser();
  if (!current?.approved || !current.onboardingCompleted) return fail(401, "Sign in to transcribe.");
  const access = await writerAccess(current);
  if (!access) return fail(403, "Transcribe is on the Pro and Expert plans.");

  const language = new URL(request.url).searchParams.get("language") ?? "en";
  if (!isTranscribeLanguage(language)) return fail(400, "Pick one of the languages in the list.");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return fail(413, `Keep it under ${TRANSCRIBE_MAX_SECONDS / 60} minutes for one go.`);

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return fail(413, `Keep it under ${TRANSCRIBE_MAX_SECONDS / 60} minutes for one go.`);

  const services = getServices();
  try {
    const transcript = await services.transcribe.transcribe(current.user.id, pcm16ToFloat(bytes), language, access.transcribeMinutes);
    const used = await services.transcribe.secondsUsed(current.user.id).catch(() => null);
    return Response.json({ ...transcript, used });
  } catch (error) {
    if (isAppError(error) && error.expose) return fail(error.status, error.message);
    logger.warn("transcription failed", { error });
    return fail(500, "Couldn't transcribe that one. Try again in a moment.");
  }
}
