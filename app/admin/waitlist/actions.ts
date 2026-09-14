"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth/session";
import { env } from "@/lib/core/env";
import { isAppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import type { BulkState } from "@/components/bulk-panel";
import { getServices } from "@/lib/services";

export interface InviteState {
  status: "idle" | "sent" | "link" | "error";
  message: string | null;
  link: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** SITE_URL if configured, otherwise the origin this request came in on. */
async function siteUrl(): Promise<string> {
  const configured = env().SITE_URL;
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function inviteEntry(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const admin = await requireAdmin();
  const entryId = String(formData.get("entryId") ?? "");
  const mode = formData.get("mode") === "link" ? "link" : "email";
  if (!UUID_PATTERN.test(entryId)) return { status: "error", message: "Invalid entry.", link: null };

  try {
    const { waitlist } = getServices();
    if (mode === "link") {
      const link = await waitlist.inviteLink(entryId, await siteUrl(), admin.user.id);
      revalidatePath("/admin/waitlist");
      return { status: "link", message: "One-time sign-in link. Send it to them directly; it expires after use.", link };
    }
    await waitlist.invite(entryId, await siteUrl(), admin.user.id);
    revalidatePath("/admin/waitlist");
    return { status: "sent", message: "Invite email sent.", link: null };
  } catch (error) {
    logger.warn("waitlist invite failed", { entryId, mode, error });
    return { status: "error", message: isAppError(error) && error.expose ? error.message : "Invite failed. Try again.", link: null };
  }
}

/** Bulk: invite by email, decline, restore to pending, or remove from the waitlist. */
export async function bulkWaitlist(_prev: BulkState, formData: FormData): Promise<BulkState> {
  const admin = await requireAdmin();
  const action = String(formData.get("action") ?? "");
  const ids = formData.getAll("ids").map(String).filter((id) => UUID_PATTERN.test(id));
  if (ids.length === 0) return { status: "error", message: "Select at least one person." };
  const services = getServices();

  try {
    if (action === "invite") {
      const url = await siteUrl();
      let sent = 0;
      const failures: string[] = [];
      for (const id of ids.slice(0, 100)) {
        try {
          await services.waitlist.invite(id, url, admin.user.id);
          sent += 1;
        } catch (error) {
          failures.push(isAppError(error) && error.expose ? error.message : "Invite failed");
          // Stop early when the email provider is rate limiting; the rest would fail too.
          if (isAppError(error) && error.code === "RATE_LIMITED") break;
        }
      }
      revalidatePath("/admin/waitlist");
      return {
        status: sent === 0 ? "error" : "ok",
        message: `Sent ${sent} invite${sent === 1 ? "" : "s"}${failures.length ? `, ${failures.length} failed` : ""}.`,
        details: [...new Set(failures)],
      };
    }
    if (action !== "remove" && action !== "decline" && action !== "restore") return { status: "error", message: "Unknown action." };
    const result = await services.moderation.moderateWaitlist(action, ids, { userId: admin.user.id, role: admin.isOwner ? "owner" : "admin" });
    revalidatePath("/admin/waitlist");
    const verb = { remove: "Removed", decline: "Declined", restore: "Moved back to pending" }[action];
    return { status: "ok", message: `${verb} ${result.applied} ${result.applied === 1 ? "person" : "people"}.` };
  } catch (error) {
    logger.warn("bulk waitlist action failed", { action, error });
    return { status: "error", message: isAppError(error) && error.expose ? error.message : "Couldn't apply that action." };
  }
}