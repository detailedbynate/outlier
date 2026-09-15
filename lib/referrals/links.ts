import "server-only";
import { headers } from "next/headers";
import { env } from "@/lib/core/env";

export const REFERRAL_COOKIE = "outlier_ref";
/** How long a referral link is remembered on a visitor's browser. */
export const REFERRAL_COOKIE_MAX_AGE = 30 * 24 * 3600;

/** Public site origin: SITE_URL when configured, otherwise the request's host. */
export async function siteOrigin(): Promise<string> {
  const configured = env().SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function referralLinks(code: string): Promise<{ share: string; status: string }> {
  const origin = await siteOrigin();
  return { share: `${origin}/?ref=${code}`, status: `${origin}/waitlist/${code}` };
}