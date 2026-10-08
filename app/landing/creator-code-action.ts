"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CREATOR_CODE_COOKIE, normalizeCreatorCode } from "@/lib/creator-codes/codes";
import { getServices } from "@/lib/services";

/**
 * Someone typed a creator's code instead of using the creator's link. It's
 * remembered just as the link would be, and they go back to the plans with the
 * discount showing, so the price they see is the price Stripe charges.
 */
export async function applyCreatorCode(formData: FormData): Promise<void> {
  const fromBilling = formData.get("from") === "billing";
  const code = normalizeCreatorCode(String(formData.get("code") ?? ""));
  const row = code ? await getServices().repositories.creatorCodes.find(code).catch(() => null) : null;
  if (!row?.active) redirect(fromBilling ? "/billing?code_error=1#plans" : "/?code_error=1#pricing");
  (await cookies()).set(CREATOR_CODE_COOKIE, row.code, {
    maxAge: 30 * 24 * 3600,
    sameSite: "lax",
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  redirect(fromBilling ? "/billing#plans" : `/?code=${row.code}#pricing`);
}
