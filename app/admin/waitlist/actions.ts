"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth/session";
import { env } from "@/lib/core/env";
import { isAppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
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
