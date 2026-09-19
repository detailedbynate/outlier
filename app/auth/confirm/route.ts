import { NextResponse, type NextRequest } from "next/server";
import { isLinkType } from "@/lib/auth/links";
import { env } from "@/lib/core/env";

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
 * GET /auth/confirm?token_hash=…&type=invite — the address in invite, sign-in
 * and reset links. It doesn't use the one-time token: chat apps and email
 * scanners open links to build previews, which would spend it before the
 * person taps it. It forwards to /auth/continue, where a button press does.
 */
export function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const origin = siteOrigin(request);
  if (!tokenHash || !isLinkType(type)) return NextResponse.redirect(new URL("/login?error=link", origin));

  const target = new URL("/auth/continue", origin);
  target.searchParams.set("token_hash", tokenHash);
  target.searchParams.set("type", type);
  const next = searchParams.get("next");
  if (next) target.searchParams.set("next", next);
  return NextResponse.redirect(target);
}
