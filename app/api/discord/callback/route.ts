import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { logger } from "@/lib/core/logger";
import { siteOrigin } from "@/lib/referrals/links";
import { getServices } from "@/lib/services";
import { DISCORD_STATE_COOKIE } from "@/lib/discord/messages";

export const dynamic = "force-dynamic";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** GET /api/discord/callback — back from Discord's sign-in: link the account and hand out the role. */
export async function GET(request: Request): Promise<Response> {
  const origin = await siteOrigin();
  const back = (result: string) => {
    const response = NextResponse.redirect(`${origin}/billing?discord=${result}#discord`);
    response.cookies.delete({ name: DISCORD_STATE_COOKIE, path: "/api/discord" });
    return response;
  };
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const state = params.get("state") ?? "";
  const expected = (await cookies()).get(DISCORD_STATE_COOKIE)?.value ?? "";
  // They pressed Cancel on Discord's screen.
  if (params.get("error")) return back("cancelled");
  if (!code || !expected || !same(state, expected)) return back("error");
  const current = await getCurrentUser();
  if (!current) return NextResponse.redirect(`${origin}/login?next=${encodeURIComponent("/billing#discord")}`);
  try {
    await getServices().discord.completeLink(current.user.id, code, `${origin}/api/discord/callback`);
    return back("linked");
  } catch (error) {
    logger.error("discord link failed", { userId: current.user.id, error: error instanceof Error ? error.message : String(error) });
    return back("error");
  }
}
