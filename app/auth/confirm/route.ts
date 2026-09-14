import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeRedirectPath } from "@/lib/auth/access";
import { createSessionClient } from "@/lib/auth/session";
import { logger } from "@/lib/core/logger";
import { getServices } from "@/lib/services";

const ALLOWED_TYPES = new Set<EmailOtpType>(["invite", "email", "magiclink", "recovery", "signup"]);

/**
 * GET /auth/confirm?token_hash=…&type=invite — verifies an emailed link and
 * signs the user in. Invites and password recovery continue to /set-password.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const failure = new URL("/login?error=link", request.url);

  if (!tokenHash || !type || !ALLOWED_TYPES.has(type)) return NextResponse.redirect(failure);

  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error || !data.user) {
    logger.warn("auth link verification failed", { type, reason: error?.message });
    return NextResponse.redirect(failure);
  }

  if (data.user.email) {
    await getServices()
      .waitlist.markJoined(data.user.email)
      .catch((e: unknown) => logger.warn("could not mark waitlist entry joined", { error: e }));
  }

  const next = type === "invite" || type === "recovery" ? "/set-password" : safeRedirectPath(searchParams.get("next"));
  return NextResponse.redirect(new URL(next, request.url));
}
