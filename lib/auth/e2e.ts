/**
 * Test-only sign-in for end-to-end tests. Active only when NOT running in
 * production AND the E2E_AUTH_TOKEN env var is set AND the request carries a
 * matching cookie. Production deployments can never use it.
 */

export const E2E_COOKIE = "outlier_e2e";

export function isE2EBypass(cookieValue: string | undefined): boolean {
  const token = process.env.E2E_AUTH_TOKEN;
  return process.env.NODE_ENV !== "production" && typeof token === "string" && token.length >= 16 && cookieValue === token;
}