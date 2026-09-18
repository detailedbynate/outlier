"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { createSessionClient, requireApprovedUser } from "@/lib/auth/session";
import { requireEnv } from "@/lib/core/env";
import { isAppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import type { OnboardingInput } from "@/lib/onboarding/schema";
import { getServices } from "@/lib/services";

export type UpdatePreferencesResult = { ok: true } | { ok: false; error: string; field?: string };

export async function updatePreferences(input: OnboardingInput): Promise<UpdatePreferencesResult> {
  const { user } = await requireApprovedUser();
  try {
    await getServices().onboarding.updatePreferences(user.id, input);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    if (isAppError(error) && error.code === "VALIDATION_ERROR") {
      const fieldErrors = (error.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors ?? {};
      return { ok: false, error: error.message, field: Object.keys(fieldErrors)[0] };
    }
    logger.error("preferences save failed", { error });
    return { ok: false, error: "We couldn't save your preferences. Please try again." };
  }
}

export interface ChangePasswordState {
  status: "idle" | "ok" | "error";
  message: string | null;
}

/** Change the signed-in user's password. The current one is checked first, so a left-open session can't be taken over. */
export async function changePassword(_prev: ChangePasswordState, formData: FormData): Promise<ChangePasswordState> {
  const current = await requireApprovedUser();
  const oldPassword = String(formData.get("current") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (!oldPassword) return { status: "error", message: "Enter your current password." };
  if (password.length < 8) return { status: "error", message: "Use at least 8 characters." };
  if (password.length > 72) return { status: "error", message: "Use 72 characters or fewer." };
  if (password !== confirm) return { status: "error", message: "New passwords don’t match." };
  if (password === oldPassword) return { status: "error", message: "Pick a password different from your current one." };

  // Check the current password on a throwaway client so the user's own session isn't touched.
  const verifier = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const check = await verifier.auth.signInWithPassword({ email: current.email, password: oldPassword });
  if (check.error) return { status: "error", message: "Your current password isn’t right." };
  await verifier.auth.signOut({ scope: "local" }).catch(() => {});

  const supabase = await createSessionClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    logger.warn("change password failed", { userId: current.user.id, reason: error.message });
    return { status: "error", message: error.message.includes("different") ? "Pick a password you haven’t used before." : "Couldn’t change your password. Try again." };
  }
  logger.info("password changed", { userId: current.user.id });
  return { status: "ok", message: "Password changed." };
}
