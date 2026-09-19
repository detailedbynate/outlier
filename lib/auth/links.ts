import type { EmailOtpType } from "@supabase/supabase-js";

/** Link types /auth/confirm accepts: invites, sign-in (magic) links, password resets, signups. */
export const LINK_TYPES = new Set<EmailOtpType>(["invite", "email", "magiclink", "recovery", "signup"]);

export function isLinkType(value: string | null | undefined): value is EmailOtpType {
  return typeof value === "string" && LINK_TYPES.has(value as EmailOtpType);
}
