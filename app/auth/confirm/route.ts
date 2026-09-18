import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeRedirectPath } from "@/lib/auth/access";
import { createSessionClient } from "@/lib/auth/session";
import { env } from "@/lib/core/env";
import { logger } from "@/lib/core/logger";
import { getServices } from "@/lib/services";

const ALLOWED_TYPES = new Set<EmailOtpType>(["invite", "email", "magiclink", "recovery", "signup"]);

/**
 * Where to send people afterwards. Behind the reverse proxy, request.url is the
 * app's own address (localhost:3000), so use the public site URL instead.
 */
function siteOrigin(request: NextRequest): string {
  const configured = env().SITE_URL;
  if (configured) return configured;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  return host ? `${request.headers.get("x-forwarded-proto") ?? "https"}://${host}` : request.url;
}

/**
 * GET /auth/confirm?token_hash=…&type=invite — verifies an emailed link and
 * signs the user in. Invites and password recovery continue to /set-password.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const origin = siteOrigin(request);
  const failure = new URL("/login?error=link", origin);

  if (!tokenHash || !type || !ALLOWED_TYPES.has(type)) return NextResponse.redirect(failure);

  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error || !data.user) {
    logger.warn("auth link verification failed", { type, reason: error?.message });
    return NextResponse.redirect(failure);
  }

  if (data.user.email) {
    const services = getServices();
    await services.waitlist.markJoined(data.user.email).catch((e: unknown) => logger.warn("could not mark waitlist entry joined", { error: e }));
    // Bonus credits for referred people and their referrers (no-op if already rewarded).
    await services.referrals.onAccountCreated(data.user.id, data.user.email);
  }

  const next = type === "invite" || type === "recovery" ? "/set-password" : safeRedirectPath(searchParams.get("next"));
  return NextResponse.redirect(new URL(next, origin));
}
