"use server";

import { redirect } from "next/navigation";
import { getAdminDatabase } from "@/lib/database";
import { createSessionClient } from "@/lib/auth/session";
import { logger } from "@/lib/core/logger";
import { getServices } from "@/lib/services";
import { hasNeverSignedIn } from "@/lib/billing/signup";
import { discordInviteUrl } from "@/lib/discord/invite";
import { emailEnabled, sendEmail, welcomeEmail } from "@/lib/email/send";

export interface SignupState {
  error: string | null;
}

/** Short enough that nobody reaches for a password manager, long enough to matter. */
const MIN_PASSWORD = 10;

/**
 * Finish a paid signup: check the invite, set the password, retire the invite,
 * and sign them straight in.
 *
 * The invite is retired only after the password is saved, so a hiccup setting it
 * leaves the link working and they can just try again. Until then the link can
 * be opened any number of times.
 */
export async function completeSignup(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < MIN_PASSWORD) return { error: `Use at least ${MIN_PASSWORD} characters.` };
  if (password !== confirm) return { error: "Those passwords don't match." };

  const invites = getServices().repositories.signupInvites;
  const invite = await invites.find(token);
  if (!invite) return { error: "Your account is already set up. Sign in instead." };
  // Got in some other way since the page loaded: the account is set up, so this link can't set the password.
  if (!(await hasNeverSignedIn(invite.user_id))) {
    await invites.retire(invite.user_id);
    return { error: "Your account is already set up. Sign in instead." };
  }

  const admin = getAdminDatabase();
  const { error } = await admin.auth.admin.updateUserById(invite.user_id, { password, email_confirm: true });
  if (error) {
    logger.error("signup password update failed", { userId: invite.user_id, reason: error.message });
    return { error: "Something went wrong setting your password. Try again in a minute — this link still works." };
  }
  // The account is set up now: this link, and any other they were sent, stops working.
  await invites.retire(invite.user_id);
  await sendWelcome(invite.user_id, invite.email);

  const supabase = await createSessionClient();
  const signedIn = await supabase.auth.signInWithPassword({ email: invite.email, password });
  if (signedIn.error) {
    logger.warn("signup sign-in failed", { userId: invite.user_id, reason: signedIn.error.message });
    redirect("/login?ready=1");
  }
  logger.info("subscriber finished signup", { userId: invite.user_id });
  redirect("/");
}

/** The Discord invite, once the account works. Best effort: a failed email must not undo a finished signup. */
async function sendWelcome(userId: string, email: string): Promise<void> {
  if (!emailEnabled()) return;
  try {
    await sendEmail({ to: email, ...welcomeEmail({ discordUrl: discordInviteUrl() }) });
  } catch (error) {
    logger.warn("welcome email failed", { userId, error });
  }
}
