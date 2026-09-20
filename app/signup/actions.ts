"use server";

import { redirect } from "next/navigation";
import { getAdminDatabase } from "@/lib/database";
import { createSessionClient } from "@/lib/auth/session";
import { logger } from "@/lib/core/logger";
import { getServices } from "@/lib/services";

export interface SignupState {
  error: string | null;
}

/** Short enough that nobody reaches for a password manager, long enough to matter. */
const MIN_PASSWORD = 10;

/**
 * Finish a paid signup: check the one-time invite, set the password, spend the
 * invite, and sign them straight in.
 *
 * The invite is spent before the password is set, because the conditional update
 * is what stops two submissions from both going through. If setting the password
 * then fails, they ask for a fresh link rather than sharing a live one.
 */
export async function completeSignup(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < MIN_PASSWORD) return { error: `Use at least ${MIN_PASSWORD} characters.` };
  if (password !== confirm) return { error: "Those passwords don't match." };

  const invites = getServices().repositories.signupInvites;
  const invite = await invites.consume(token);
  if (!invite) return { error: "This link has already been used or has expired. Ask for a new one below." };

  const admin = getAdminDatabase();
  const { error } = await admin.auth.admin.updateUserById(invite.user_id, { password, email_confirm: true });
  if (error) {
    logger.error("signup password update failed", { userId: invite.user_id, reason: error.message });
    return { error: "Something went wrong setting your password. Try the link again in a minute." };
  }

  const supabase = await createSessionClient();
  const signedIn = await supabase.auth.signInWithPassword({ email: invite.email, password });
  if (signedIn.error) {
    logger.warn("signup sign-in failed", { userId: invite.user_id, reason: signedIn.error.message });
    redirect("/login?ready=1");
  }
  logger.info("subscriber finished signup", { userId: invite.user_id });
  redirect("/");
}
