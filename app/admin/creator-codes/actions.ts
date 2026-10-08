"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { createCreatorCode } from "@/lib/billing/creator-codes";
import { logger } from "@/lib/core/logger";
import { displayCode, normalizeCreatorCode } from "@/lib/creator-codes/codes";
import { getServices } from "@/lib/services";

export interface CreatorCodeFormState {
  status: "idle" | "ok" | "error";
  message: string | null;
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

function whole(formData: FormData, key: string, min: number, max: number): number | null {
  const value = Number(text(formData, key));
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

export async function createCode(_prev: CreatorCodeFormState, formData: FormData): Promise<CreatorCodeFormState> {
  await requireAdmin();
  const code = normalizeCreatorCode(text(formData, "code"));
  if (!code) return { status: "error", message: "Codes are 2-20 letters, numbers, - or _." };
  const creatorName = text(formData, "creatorName").slice(0, 100);
  if (!creatorName) return { status: "error", message: "Add the creator's name." };
  const discountPercent = whole(formData, "discountPercent", 1, 100);
  const discountMonths = whole(formData, "discountMonths", 1, 36);
  const commissionPercent = whole(formData, "commissionPercent", 0, 100);
  if (discountPercent === null || discountMonths === null || commissionPercent === null) {
    return { status: "error", message: "Discount is 1-100% for 1-36 months; commission is 0-100%." };
  }
  const rawMonths = text(formData, "commissionMonths");
  const commissionMonths = rawMonths === "" ? null : whole(formData, "commissionMonths", 1, 120);
  if (rawMonths !== "" && commissionMonths === null) return { status: "error", message: "Commission months is 1-120, or blank for as long as they pay." };

  const email = text(formData, "email");
  let userId: string | null = null;
  if (email) {
    userId = await getServices().repositories.accounts.userIdByEmail(email);
    if (!userId) return { status: "error", message: `No Outlier account for ${email}. Leave it blank, or have them sign up first.` };
  }

  try {
    const created = await createCreatorCode({ code, creatorName, userId, discountPercent, discountMonths, commissionPercent, commissionMonths });
    if (created === "taken") return { status: "error", message: `${displayCode(code)} is already taken.` };
  } catch (error) {
    logger.error("creator code create failed", { code, error });
    return { status: "error", message: "Couldn't make the code in Stripe. Check Stripe is set up and try again." };
  }
  revalidatePath("/admin/creator-codes");
  return { status: "ok", message: `${displayCode(code)} is live.` };
}

export async function setCodeActive(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = text(formData, "id");
  if (!id) return;
  await getServices().repositories.creatorCodes.setActive(id, text(formData, "active") === "1");
  revalidatePath("/admin/creator-codes");
}

export async function markPaidOut(formData: FormData): Promise<void> {
  const current = await requireAdmin();
  const id = text(formData, "id");
  if (!id) return;
  const cents = await getServices().repositories.creatorCodes.markPaidOut(id, new Date());
  logger.info("creator commission paid out", { codeId: id, cents, by: current.user.id });
  revalidatePath("/admin/creator-codes");
}

/** A new discount for anyone who checks out from now on. People already subscribed keep theirs. */
export async function setCodeDiscount(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const percent = Math.round(Number(formData.get("discountPercent")));
  const months = Math.round(Number(formData.get("discountMonths")));
  if (!id || !(percent >= 1 && percent <= 100) || !(months >= 1 && months <= 36)) return;
  await getServices().repositories.creatorCodes.setDiscount(id, percent, months);
  revalidatePath("/admin/creator-codes");
}
