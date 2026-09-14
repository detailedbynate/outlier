"use server";

import { redirect } from "next/navigation";
import { createSessionClient, getCurrentUser } from "@/lib/auth/session";
import { logger } from "@/lib/core/logger";

export interface SetPasswordState {
  error: string | null;
}

export async function setPassword(_prev: SetPasswordState, formData: FormData): Promise<SetPasswordState> {
  if (!(await getCurrentUser())) redirect("/login");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 8) return { error: "Use at least 8 characters." };
  if (password.length > 72) return { error: "Use 72 characters or fewer." };
  if (password !== confirm) return { error: "Passwords don’t match." };

  const supabase = await createSessionClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    logger.warn("set password failed", { reason: error.message });
    return { error: error.message.includes("different") ? "Choose a password you haven’t used before." : "Couldn’t save your password. Try again." };
  }
  redirect("/");
}
