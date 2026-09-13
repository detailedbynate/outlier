/** Pure access rules, kept free of framework imports so they're easy to test. */

export function parseAllowedEmails(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Accounts are invite-only (created in the Supabase dashboard). ALLOWED_EMAILS
 * narrows access further; when it is blank, every signed-in account is allowed.
 */
export function isEmailAllowed(email: string | null | undefined, allowedEmails: Set<string>): boolean {
  if (!email) return false;
  return allowedEmails.size === 0 || allowedEmails.has(email.trim().toLowerCase());
}

/** Only allow same-site relative redirects after login (blocks open redirects like //evil.com). */
export function safeRedirectPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }
  return value;
}
