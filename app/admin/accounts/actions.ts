"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth/session";
import { env } from "@/lib/core/env";
import { isAppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import type { BulkState } from "@/components/bulk-panel";
import { getServices } from "@/lib/services";
import { findPlan, type PlanId } from "@/lib/billing/plans";

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
/** A fresh one-time sign-in link for an account, for when the first one was lost or used. */
export async function newSignInLink(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const current = await requireAdmin();
  const userId = text(formData, "userId");
  if (!UUID_PATTERN.test(userId)) return { status: "error", message: "Invalid account.", link: null };
  try {
    const link = await getServices().accounts.accessLink(
      userId,
      text(formData, "email"),
      { userId: current.user.id, role: current.isOwner ? "owner" : "admin" },
      await confirmUrl(),
    );
    return { status: "ok", message: "New link ready. It works once and lets them set a password.", link };
  } catch (error) {
    logger.warn("new sign-in link failed", { userId, error });
    return { status: "error", message: isAppError(error) && error.expose ? error.message : "Couldn't create a link.", link: null };
  }
}

/** Owner only: add or remove a user's extra credits (these don't reset monthly). */
export async function adjustCredits(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const current = await requireAdmin();
  if (!current.isOwner) return { status: "error", message: "Only the owner can change credits.", link: null };
  const userId = text(formData, "userId");
  if (!UUID_PATTERN.test(userId)) return { status: "error", message: "Invalid account.", link: null };
  const amount = Number(text(formData, "amount"));
  try {
    const { extra } = await getServices().credits.adjust(userId, amount, text(formData, "note") || null, current.user.id);
    revalidatePath("/admin/accounts");
    return { status: "ok", message: `${amount > 0 ? "Added" : "Removed"} ${Math.abs(amount)}. Extra credits now ${extra}.`, link: null };
  } catch (error) {
    logger.warn("adjust credits failed", { userId, error });
    return { status: "error", message: isAppError(error) && error.expose ? error.message : "Couldn't change credits.", link: null };
  }
}

/**
 * Put an account on a plan by hand.
 *
 * For comps, support fixes and testing — nothing here talks to Stripe, so this
 * is an override, not a purchase: if Stripe later sends a webhook for this user
 * it wins, because it reflects what they're actually being charged. Moving
 * someone to Free clears the entitlement rather than recording a cancellation
 * date, since there's no billing period to run out.
 */
export async function setAccountPlan(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const current = await requireAdmin();
  const userId = text(formData, "userId");
  const plan = findPlan(text(formData, "plan"));
  if (!UUID_PATTERN.test(userId)) return { status: "error", message: "Invalid account.", link: null };
  if (!plan) return { status: "error", message: "Unknown plan.", link: null };
  if (!current.isOwner) return { status: "error", message: "Only the owner can change plans.", link: null };

  try {
    const services = getServices();
    const existing = await services.subscriptions.stateFor(userId);
    await services.subscriptions.apply({
      userId,
      plan: plan.id as PlanId,
      // "canceled" is what the rest of the app reads as "no entitlement".
      status: plan.id === "free" ? "canceled" : "active",
      // Keep any Stripe ids we already had: losing them would orphan a real
      // subscription from the customer it belongs to.
      stripeCustomerId: existing.stripeCustomerId,
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
    logger.info("plan set by admin", { userId, plan: plan.id, actor: current.user.id });
    revalidatePath("/admin/accounts");
    revalidatePath("/", "layout");
    return { status: "ok", message: `Now on ${plan.name}.`, link: null };
  } catch (error) {
    logger.warn("set plan failed", { userId, error });
    return { status: "error", message: isAppError(error) && error.expose ? error.message : "Couldn't change the plan.", link: null };
  }
}
