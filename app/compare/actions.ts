"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireApprovedUser } from "@/lib/auth/session";
import { isAppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { channelReferenceSchema, MAX_COMPETITORS } from "@/lib/onboarding/schema";
import { getServices } from "@/lib/services";
import { asUser } from "@/lib/youtube/quota-context";

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

function hrefFor(you: string, competitors: string[], extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  if (you) params.set("you", you);
  for (const c of competitors) params.append("c", c);
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  const qs = params.toString();
  return `/compare${qs ? `?${qs}` : ""}`;
}

/**
 * Sync missing or stale channels (quota-gated, rate-limited), optionally save the
 * list to preferences, then show the page. Fresh channels cost no YouTube quota.
 */
export async function syncCompetitors(formData: FormData): Promise<void> {
  const { user } = await requireApprovedUser();
  const services = getServices();
  const you = text(formData, "you");
  const competitors = [...new Set(formData.getAll("c").map((c) => String(c).trim()).filter(Boolean))]
    .filter((c) => channelReferenceSchema.safeParse(c).success)
    .slice(0, MAX_COMPETITORS);
  const validYou = you && channelReferenceSchema.safeParse(you).success ? you : "";
  let status = "synced";

  try {
    await services.rateLimits.enforce("compareUser", user.id);
    const result = await asUser(user.id, "action:competitor_sync", () => services.competitors.sync({ you: validYou || null, competitors }));
    if (result.failures.length) status = `failed:${result.failures.length}`;
    if (formData.get("save") === "on") await services.repositories.preferences.updateChannels(user.id, validYou || null, competitors);
  } catch (error) {
    logger.warn("competitor sync failed", { error });
    status = isAppError(error) && error.code === "RATE_LIMITED" ? "rate_limited" : isAppError(error) && error.code === "QUOTA_EXCEEDED" ? "quota" : "error";
  }
  revalidatePath("/compare");
  revalidatePath("/");
  redirect(hrefFor(validYou, competitors, { status }));
}

export async function saveCompetitorAlerts(formData: FormData): Promise<void> {
  const { user } = await requireApprovedUser();
  await getServices().competitors.setAlerts(user.id, formData.getAll("alerts").map(String));
  revalidatePath("/compare");
}