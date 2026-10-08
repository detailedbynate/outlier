import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { siteOrigin } from "@/lib/referrals/links";
import { getServices } from "@/lib/services";
import { DISCORD_STATE_COOKIE } from "@/lib/discord/messages";

export const dynamic = "force-dynamic";

/** GET /api/discord/connect — "Connect Discord" in Billing: off to Discord's sign-in. */
export async function GET(): Promise<Response> {
  const origin = await siteOrigin();
  const current = await getCurrentUser();
  if (!current) return NextResponse.redirect(`${origin}/login?next=${encodeURIComponent("/billing#discord")}`);
  const state = randomBytes(18).toString("base64url");
  const url = getServices().discord.authorizeUrl(state, `${origin}/api/discord/callback`);
  if (!url) return NextResponse.redirect(`${origin}/billing?discord=off#discord`);
  const response = NextResponse.redirect(url);
  response.cookies.set(DISCORD_STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https:"), path: "/api/discord", maxAge: 600 });
  return response;
}
