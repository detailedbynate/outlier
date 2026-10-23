import { headers } from "next/headers";
import { isAppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { getServices } from "@/lib/services";
import { clientIpFrom } from "@/lib/services/rate-limit-service";
import { FREE_TRANSCRIBE_MAX_SECONDS } from "@/lib/services/transcribe-service";
import { SAMPLE_RATE, pcm16ToFloat } from "@/lib/transcribe/audio";
import { isTranscribeLanguage } from "@/lib/transcribe/languages";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = (FREE_TRANSCRIBE_MAX_SECONDS + 2) * SAMPLE_RATE * 2;

const fail = (status: number, error: string) => Response.json({ error }, { status });

/**
 * POST /api/tools/captions?language=en — the free, signed-out caption tool on
 * /tools/srt-generator. Same body as /api/transcribe (16 kHz mono 16-bit PCM),
 * capped at a minute, a few files a day per IP.
 */
export async function POST(request: Request): Promise<Response> {
  const language = new URL(request.url).searchParams.get("language") ?? "en";
  if (!isTranscribeLanguage(language)) return fail(400, "Pick one of the languages in the list.");
  const tooLong = `The free tool takes up to ${FREE_TRANSCRIBE_MAX_SECONDS} seconds. Trim it, or use Outlier for up to 5 minutes a file.`;
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return fail(413, tooLong);

  const services = getServices();
  try {
    await services.rateLimits.enforce("freeCaptionsIp", clientIpFrom(await headers()));
  } catch (error) {
    if (isAppError(error) && error.code === "RATE_LIMITED") return fail(429, "That's today's 3 free files. Outlier members get 20+ minutes a day.");
    throw error;
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return fail(413, tooLong);

  try {
    const transcript = await services.transcribe.transcribeFree(pcm16ToFloat(bytes), language);
    return Response.json({ ...transcript, used: null });
  } catch (error) {
    if (isAppError(error) && error.expose) return fail(error.status, error.message);
    logger.warn("free transcription failed", { error });
    return fail(500, "Couldn't transcribe that one. Try again in a moment.");
  }
}
