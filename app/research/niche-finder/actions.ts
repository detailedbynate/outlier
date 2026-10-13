"use server";

import { revalidatePath } from "next/cache";
import { requireApprovedUser } from "@/lib/auth/session";
import { paidFeaturesLocked } from "@/lib/billing/feature-gate";
import { logger } from "@/lib/core/logger";
import { getAdminDatabase } from "@/lib/database";
import { HIDDEN_NICHES_KEY, readHiddenNiches, readSavedNiches, SAVED_NICHES_KEY, withHidden, withoutSaved, withSaved } from "@/lib/niches/saved";

/**
 * Save or unsave a niche. The list lives in the account's metadata; the auth
 * server merges metadata keys, so only this one key is written.
 */
export async function toggleSavedNiche(formData: FormData): Promise<void> {
  const current = await requireApprovedUser();
  if (await paidFeaturesLocked(current)) return;
  const topic = String(formData.get("topic") ?? "").trim().slice(0, 60);
  const score = Number(formData.get("score"));
  const save = formData.get("save") === "1";
  if (!topic) return;

  const list = readSavedNiches(current.user.user_metadata);
  const next = save ? withSaved(list, topic, Number.isFinite(score) ? Math.round(score) : 0, new Date()) : withoutSaved(list, topic);
  if (current.isTestSession) return;
  const { error } = await getAdminDatabase().auth.admin.updateUserById(current.user.id, { user_metadata: { [SAVED_NICHES_KEY]: next } });
  if (error) {
    logger.warn("could not save niche list", { error: error.message });
    return;
  }
  revalidatePath("/research/niche-finder");
  revalidatePath("/");
}

/** "Not for me" on a Discover card hides that niche for this account; "show" with no topic brings them all back. */
export async function hideNiche(formData: FormData): Promise<void> {
  const current = await requireApprovedUser();
  if (await paidFeaturesLocked(current)) return;
  const topic = String(formData.get("topic") ?? "").trim().slice(0, 60);
  const next = topic ? withHidden(readHiddenNiches(current.user.user_metadata), topic) : [];
  if (current.isTestSession) return;
  const { error } = await getAdminDatabase().auth.admin.updateUserById(current.user.id, { user_metadata: { [HIDDEN_NICHES_KEY]: next } });
  if (error) {
    logger.warn("could not save hidden niches", { error: error.message });
    return;
  }
  revalidatePath("/research/niche-finder");
}
