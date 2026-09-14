"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth/session";
import { env } from "@/lib/core/env";
import { isAppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { getServices } from "@/lib/services";

export interface AccountFormState {
  status: "idle" | "ok" | "error";
  message: string | null;
  link: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function confirmUrl(): Promise<string> {
  let base = env().SITE_URL;
  if (!base) {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
    base = `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
  }
  return new URL("/auth/confirm", base).toString();
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

export async function createAccount(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const current = await requireAdmin();
  try {
    const { account, link, existed } = await getServices().accounts.create(
      {
        email: text(formData, "email"),
        role: text(formData, "role") || "member",
        dailyCredits: text(formData, "dailyCredits"),
        youtubeDailyUnits: text(formData, "youtubeDailyUnits"),
        note: text(formData, "note"),
        delivery: text(formData, "delivery") || "link",
      },
      { userId: current.user.id, role: current.isOwner ? "owner" : "admin" },
      await confirmUrl(),
    );
    revalidatePath("/admin/accounts");
    const message = link
      ? `Account ready for ${account.email}. Send them this one-time sign-in link.`
      : existed
        ? `${account.email} already had an account. Their limits were updated.`
        : `Invite email sent to ${account.email}.`;
    return { status: "ok", message, link };
  } catch (error) {
    logger.warn("create account failed", { error });
    return { status: "error", message: isAppError(error) && error.expose ? error.message : "Couldn't create the account.", link: null };
  }
}

export async function updateAccount(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const current = await requireAdmin();
  const userId = text(formData, "userId");
  if (!UUID_PATTERN.test(userId)) return { status: "error", message: "Invalid account.", link: null };
  try {
    await getServices().accounts.update(
      userId,
      {
        role: text(formData, "role") || undefined,
        dailyCredits: text(formData, "dailyCredits"),
        youtubeDailyUnits: text(formData, "youtubeDailyUnits"),
        note: text(formData, "note"),
        disabled: formData.get("disabled") === "on",
      },
      { userId: current.user.id, role: current.isOwner ? "owner" : "admin" },
    );
    revalidatePath("/admin/accounts");
    return { status: "ok", message: "Saved.", link: null };
  } catch (error) {
    logger.warn("update account failed", { userId, error });
    return { status: "error", message: isAppError(error) && error.expose ? error.message : "Couldn't save.", link: null };
  }
}