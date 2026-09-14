"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireApprovedUser } from "@/lib/auth/session";
import { isAppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import type { OnboardingInput } from "@/lib/onboarding/schema";
import { getServices } from "@/lib/services";

export type CompleteOnboardingResult = { ok: true } | { ok: false; error: string; field?: string };

export async function completeOnboarding(input: OnboardingInput): Promise<CompleteOnboardingResult> {
  const { user } = await requireApprovedUser({ allowIncompleteOnboarding: true });
  try {
    await getServices().onboarding.complete(user.id, input);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    if (isAppError(error) && error.code === "VALIDATION_ERROR") {
      const fieldErrors = (error.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors ?? {};
      return { ok: false, error: error.message, field: Object.keys(fieldErrors)[0] };
    }
    logger.error("onboarding save failed", { error });
    return { ok: false, error: "We couldn't save your answers. Please try again." };
  }
}

/** Clear preferences and restart onboarding. */
export async function resetOnboarding(): Promise<void> {
  const { user } = await requireApprovedUser();
  await getServices().onboarding.reset(user.id);
  revalidatePath("/", "layout");
  redirect("/onboarding");
}
