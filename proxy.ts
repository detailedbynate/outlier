import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { E2E_COOKIE, isE2EBypass } from "./lib/auth/e2e";
import { LANDING_HEADER } from "./lib/landing-link";

/** Reachable without signing in. Prefix match for entries ending in "/". */
// /signup and /welcome are where a paying subscriber lands before they have an
// account to sign in with, so they can't be behind the sign-in gate.
const PUBLIC_PATHS = ["/", "/login", "/login/forgot", "/signup", "/welcome", "/privacy", "/terms", "/refunds", "/auth/", "/waitlist/"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => (path.endsWith("/") && path !== "/" ? pathname.startsWith(path) : pathname === path));
}

/**
 * Refreshes the Supabase session cookie and sends signed-out visitors to /login.
 * This is an optimistic gate only — pages and actions re-check with requireApprovedUser().
 */
export async function proxy(request: NextRequest) {
  // A creator or referral link (/?code=X, /?ref=X) shows the landing page even
  // to someone signed in, so the layout must skip the app shell. It can't see
  // the query string, so it's told with a request header.
  const landingLink = request.nextUrl.pathname === "/" && (request.nextUrl.searchParams.has("code") || request.nextUrl.searchParams.has("ref"));
  const forward = () => {
    const headers = new Headers(request.headers);
    headers.delete(LANDING_HEADER);
    if (landingLink) headers.set(LANDING_HEADER, "1");
    return NextResponse.next({ request: { headers } });
  };
  let response = forward();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = forward();
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  // Remember referral links for 30 days so a signup later still credits the referrer.
  const ref = request.nextUrl.searchParams.get("ref")?.trim().toLowerCase();
  if (ref && /^[a-z0-9]{6,16}$/.test(ref)) {
    response.cookies.set("outlier_ref", ref, { maxAge: 30 * 24 * 3600, sameSite: "lax", path: "/", httpOnly: true, secure: request.nextUrl.protocol === "https:" });
  }
  // Creator codes (?code=NATE) are remembered the same way, for the discount at checkout.
  const code = request.nextUrl.searchParams.get("code")?.trim().toLowerCase();
  if (code && /^[a-z0-9][a-z0-9_-]{1,19}$/.test(code)) {
    response.cookies.set("outlier_code", code, { maxAge: 30 * 24 * 3600, sameSite: "lax", path: "/", httpOnly: true, secure: request.nextUrl.protocol === "https:" });
  }
  // A random id for counting unique visitors across days (lib/analytics/site.ts). Nothing else is in it.
  // Not for anyone who opted out or whose browser sends Global Privacy Control: they're counted cookieless.
  if (!request.cookies.get("outlier_vid") && !request.cookies.get("outlier_notrack") && request.headers.get("sec-gpc") !== "1") {
    response.cookies.set("outlier_vid", crypto.randomUUID(), { maxAge: 365 * 24 * 3600, sameSite: "lax", path: "/", httpOnly: true, secure: request.nextUrl.protocol === "https:" });
  }
  if (!user && !isE2EBypass(request.cookies.get(E2E_COOKIE)?.value) && !isPublic(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(loginUrl);
  }
  return response;
}

export const config = {
  // Skip API routes (they use API keys), Next internals, and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|mp4|webm)$).*)"],
};
