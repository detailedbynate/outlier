"use server";

import { redirect } from "next/navigation";
import { safeRedirectPath } from "@/lib/auth/access";
import { isLinkType } from "@/lib/auth/links";
import { createSessionClient } from "@/lib/auth/session";
import { logger } from "@/lib/core/logger";
import { getServices } from "@/lib/services";

/** Uses the one-time token and signs the person in. Invites and password resets continue to /set-password. */
export async function verifySignInLink(formData: FormData): Promise<void> {
  const tokenHash = String(formData.get("token_hash") ?? "");
  const type = String(formData.get("type") ?? "");
  if (!tokenHash || !isLinkType(type)) redirect("/login?error=link");

  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error || !data.user) {
    logger.warn("auth link verification failed", { type, reason: error?.message });
    redirect("/login?error=link");
  }

  if (data.user.email) {
    const services = getServices();
    await services.waitlist.markJoined(data.user.email).catch((e: unknown) => logger.warn("could not mark waitlist entry joined", { error: e }));
    // Bonus credits for referred people and their referrers (no-op if already rewarded).
    await services.referrals.onAccountCreated(data.user.id, data.user.email);
  }

  redirect(type === "invite" || type === "recovery" ? "/set-password" : safeRedirectPath(formData.get("next")));
}
