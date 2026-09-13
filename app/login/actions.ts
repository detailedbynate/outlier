"use server";

import { redirect } from "next/navigation";
import { safeRedirectPath } from "@/lib/auth/access";
import { createSessionClient } from "@/lib/auth/session";
import { logger } from "@/lib/core/logger";

export interface SignInState {
  error: string | null;
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const supabase = await createSessionClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    logger.warn("sign in failed", { reason: error.message });
    return { error: "Incorrect email or password." };
  }
  redirect(safeRedirectPath(formData.get("next")));
}

export async function signOut(): Promise<void> {
  const supabase = await createSessionClient();
  await supabase.auth.signOut();
  redirect("/login");
}
