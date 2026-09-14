import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { env, requireEnv } from "@/lib/core/env";
import { getServices } from "@/lib/services";
import { isEmailAllowed, parseAllowedEmails } from "./access";

/** Supabase client bound to the request's auth cookies (anon key; RLS applies). */
export async function createSessionClient() {
  const cookieStore = await cookies();
  return createServerClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only; the proxy refreshes them instead.
        }
      },
    },
  });
}

export interface CurrentUser {
  user: User;
  email: string;
  approved: boolean;
  isAdmin: boolean;
}

/** The signed-in user for this request (validated with Supabase Auth, not just the cookie). Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const email = data.user.email ?? "";
  const config = env();
  const isAdmin = email !== "" && parseAllowedEmails(config.ADMIN_EMAILS).has(email.toLowerCase());
  let approved = isAdmin || isEmailAllowed(email, parseAllowedEmails(config.ALLOWED_EMAILS));
  // With an allowlist in place, people invited from the waitlist still get in.
  if (!approved && email) approved = await getServices().waitlist.isInvited(email);
  return { user: data.user, email, approved, isAdmin };
});

/** Use at the top of every protected page and server action. */
export async function requireApprovedUser(): Promise<CurrentUser> {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  if (!current.approved) redirect("/not-approved");
  return current;
}

/** Use at the top of admin pages and actions. */
export async function requireAdmin(): Promise<CurrentUser> {
  const current = await requireApprovedUser();
  if (!current.isAdmin) redirect("/");
  return current;
}