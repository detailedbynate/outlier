import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { env, requireEnv } from "@/lib/core/env";
import { moderationState, type ModerationState } from "@/lib/moderation/status";
import { getServices } from "@/lib/services";
import { isEmailAllowed, parseAllowedEmails } from "./access";
import { E2E_COOKIE, isE2EBypass } from "./e2e";

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
  /** Founder/owner: unlimited, manages admins. */
  isOwner: boolean;
  role: "owner" | "admin" | "member" | null;
  /** Ban/suspension/restriction currently in effect (status "active" when none). */
  moderation: ModerationState;
  /** Finished first-run onboarding (only checked for approved users). */
  onboardingCompleted: boolean;
  /** Set for end-to-end test sessions so they don't record activity. */
  isTestSession?: boolean;
}

/** The signed-in user for this request (validated with Supabase Auth, not just the cookie). Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const cookieStore = await cookies();
  if (isE2EBypass(cookieStore.get(E2E_COOKIE)?.value)) return e2eOwner();
  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const email = data.user.email ?? "";
  const config = env();
  const services = getServices();
  const account = await services.accounts.forUser(data.user.id, email || null);
  const role = account?.role ?? null;
  const isOwner = role === "owner" || services.accounts.isOwnerEmail(email);
  const moderation = isOwner ? moderationState(null) : moderationState(account);
  const banned = moderation.status === "banned" || moderation.status === "suspended";
  const isAdmin = isOwner || role === "admin" || (email !== "" && parseAllowedEmails(config.ADMIN_EMAILS).has(email.toLowerCase()));
  // Accounts created at /admin/accounts are approved; disabled accounts never are.
  let approved = !banned && (isAdmin || account !== null || isEmailAllowed(email, parseAllowedEmails(config.ALLOWED_EMAILS)));
  // With an allowlist in place, people invited from the waitlist still get in.
  if (!approved && !banned && email) approved = await services.waitlist.isInvited(email);
  const onboardingCompleted = approved ? await services.onboarding.isCompleted(data.user.id) : false;
  return { user: data.user, email, approved, isAdmin: isAdmin && !banned, isOwner, moderation, role: isOwner ? "owner" : isAdmin ? "admin" : role, onboardingCompleted };
});

/** End-to-end tests sign in as the owner account (see ./e2e.ts for when this is allowed). */
async function e2eOwner(): Promise<CurrentUser | null> {
  const owner = (await getServices().accounts.list()).find((a) => a.role === "owner");
  if (!owner) return null;
  return {
    user: { id: owner.user_id, email: owner.email, user_metadata: {} } as User,
    email: owner.email,
    approved: true,
    isAdmin: true,
    isOwner: true,
    role: "owner",
    moderation: moderationState(null),
    onboardingCompleted: true,
    isTestSession: true,
  };
}

/**
 * Use at the top of every protected page and server action. Users who haven't
 * finished onboarding are sent there first (except from onboarding itself).
 */
export async function requireApprovedUser(options: { allowIncompleteOnboarding?: boolean } = {}): Promise<CurrentUser> {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  if (!current.approved) redirect("/not-approved");
  if (!current.onboardingCompleted && !options.allowIncompleteOnboarding) redirect("/onboarding");
  return current;
}

/** Use at the top of admin pages and actions. */
export async function requireAdmin(): Promise<CurrentUser> {
  const current = await requireApprovedUser();
  if (!current.isAdmin) redirect("/");
  return current;
}