import { NO_TRACK_COOKIE, VISITOR_COOKIE } from "@/lib/analytics/site";

export const dynamic = "force-dynamic";

/**
 * POST /api/track/opt-out — stop (or, with count=1, resume) counting this
 * browser's visits. Forms on the privacy page and the admin traffic page post
 * here; it sends you back where you were.
 */
export async function POST(request: Request): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const resume = form?.get("count") === "1";
  const back = String(form?.get("back") ?? "/");
  const location = back.startsWith("/") && !back.startsWith("//") ? back : "/";
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";

  const headers = new Headers({ Location: location });
  if (resume) {
    headers.append("Set-Cookie", `${NO_TRACK_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`);
  } else {
    // Readable by the page so the tracker doesn't even send; holds nothing but "1".
    headers.append("Set-Cookie", `${NO_TRACK_COOKIE}=1; Path=/; Max-Age=${5 * 365 * 24 * 3600}; SameSite=Lax${secure}`);
    headers.append("Set-Cookie", `${VISITOR_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`);
  }
  return new Response(null, { status: 303, headers });
}
