"use server";

import { revalidatePath } from "next/cache";
import { requireApprovedUser } from "@/lib/auth/session";
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
