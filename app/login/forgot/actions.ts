"use server";

import { headers } from "next/headers";
import { createPasswordLink } from "@/lib/auth/invites";
import { env } from "@/lib/core/env";
import { isAppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { getAdminDatabase } from "@/lib/database";
import { emailEnabled, passwordResetEmail, sendEmail } from "@/lib/email/send";
import { getServices } from "@/lib/services";
import { clientIpFrom } from "@/lib/services/rate-limit-service";

export interface ResetState {
  status: "idle" | "sent" | "error";
  message: string | null;
}

/** Same answer whether or not the address has an account, so the form can't be used to find out who does. */
const SENT: ResetState = {
  status: "sent",
  message: "If there's an Outlier account for that email, a link to reset your password is on its way. Check your inbox and spam folder.",
};

/** Emails a one-time link that signs the person in and takes them to /set-password. */
export async function requestPasswordReset(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) return { status: "error", message: "Enter the email you signed up with." };

  try {
    const { rateLimits } = getServices();
    await rateLimits.enforce("passwordResetIp", clientIpFrom(await headers()));
    await rateLimits.enforce("passwordResetEmail", email);
  } catch (error) {
    if (isAppError(error) && error.code === "RATE_LIMITED") return { status: "error", message: error.message };
    throw error;
  }

  if (!emailEnabled()) {
    logger.error("password reset requested but no email provider is configured");
    return { status: "error", message: "Password resets aren't available right now. Email us and we'll sort it out." };
  }

  try {
    if (!(await getServices().repositories.accounts.userIdByEmail(email))) return SENT;
    const site = env().SITE_URL ?? "https://www.useoutlier.online";
    const url = await createPasswordLink(getAdminDatabase(), email, `${site}/auth/confirm`);
    const { subject, html, text } = passwordResetEmail({ url });
    await sendEmail({ to: email, subject, html, text });
  } catch (error) {
    logger.error("password reset email failed", { error });
    return { status: "error", message: "We couldn't send the email. Try again in a minute." };
  }
  return SENT;
}
