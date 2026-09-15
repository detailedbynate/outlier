import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { E2E_COOKIE, isE2EBypass } from "./lib/auth/e2e";

/** Reachable without signing in. Prefix match for entries ending in "/". */
const PUBLIC_PATHS = ["/", "/login", "/privacy", "/terms", "/auth/"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => (path.endsWith("/") && path !== "/" ? pathname.startsWith(path) : pathname === path));
}

/**
 * Refreshes the Supabase session cookie and sends signed-out visitors to /login.
 * This is an optimistic gate only — pages and actions re-check with requireApprovedUser().
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
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
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
