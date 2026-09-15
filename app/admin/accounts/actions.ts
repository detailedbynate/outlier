"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth/session";
import { env } from "@/lib/core/env";
import { isAppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import type { BulkState } from "@/components/bulk-panel";
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
        monthlyCredits: text(formData, "monthlyCredits"),
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
        ? `${account.email} already had an account, so their limits were updated and a sign-in email was sent.`
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
        monthlyCredits: text(formData, "monthlyCredits"),
        youtubeDailyUnits: text(formData, "youtubeDailyUnits"),
        note: text(formData, "note"),
        email: text(formData, "email") || undefined,
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

export async function moderateAccounts(_prev: BulkState, formData: FormData): Promise<BulkState> {
  const current = await requireAdmin();
  const action = text(formData, "action");
  try {
    const result = await getServices().moderation.moderateAccounts(
      {
        action,
        userIds: formData.getAll("ids").map(String),
        durationHours: text(formData, "durationHours") || undefined,
        reason: text(formData, "reason"),
        monthlyCredits: formData.has("monthlyCredits") ? text(formData, "monthlyCredits") : undefined,
        youtubeDailyUnits: formData.has("youtubeDailyUnits") ? text(formData, "youtubeDailyUnits") : undefined,
      },
      { userId: current.user.id, role: current.isOwner ? "owner" : "admin" },
    );
    revalidatePath("/admin/accounts");
    const skipped = result.skipped.length;
    return {
      status: result.applied === 0 && skipped > 0 ? "error" : "ok",
      message: `Applied to ${result.applied} account${result.applied === 1 ? "" : "s"}${skipped ? `, skipped ${skipped}` : ""}.`,
      details: result.skipped.map((s) => `${s.target}: ${s.reason}`),
    };
  } catch (error) {
    logger.warn("bulk moderation failed", { action, error });
    return { status: "error", message: isAppError(error) && error.expose ? error.message : "Couldn't apply that action." };
  }
}