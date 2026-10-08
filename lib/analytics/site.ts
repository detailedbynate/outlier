import { createHash } from "node:crypto";

/**
 * Site traffic without cookies. A visitor is a hash of their IP, browser and
 * the day plus a server secret: the same person counts once a day, and can't
 * be followed from one day to the next or traced back to an IP.
 */

export const SITE_EVENT_KINDS = ["pageview", "pricing_view", "checkout_start", "subscribed", "purchase", "waitlist_join"] as const;
export type SiteEventKind = (typeof SITE_EVENT_KINDS)[number];
/** What the browser may report; the rest only the server records. */
export const CLIENT_EVENT_KINDS: readonly SiteEventKind[] = ["pageview", "pricing_view"];

const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|embedly|curl|wget|python|httpclient|axios|node-fetch|go-http|monitor|uptime/i;

export function isBot(userAgent: string | null): boolean {
  return !userAgent || BOT.test(userAgent);
}

export function visitorId(input: { ip: string; userAgent: string; salt: string; now: Date }): string {
  const day = input.now.toISOString().slice(0, 10);
  return createHash("sha256").update(`${day}|${input.ip}|${input.userAgent}|${input.salt}`).digest("hex").slice(0, 20);
}

export function deviceOf(userAgent: string): "mobile" | "tablet" | "desktop" {
  if (/iPad|Tablet/i.test(userAgent)) return "tablet";
  return /Mobi|Android|iPhone/i.test(userAgent) ? "mobile" : "desktop";
}

/** The site a visitor came from, or null for direct visits and our own pages. */
export function referrerHost(referrer: string | null | undefined, ownHost: string | null): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "").toLowerCase();
    if (!host || (ownHost && host === ownHost.replace(/^www\./, "").split(":")[0]!.toLowerCase())) return null;
    return host.slice(0, 120);
  } catch {
    return null;
  }
}

// Pages with an id in the path count as one page each, or the top pages list is all ids.
const ID_ROUTES: [RegExp, string][] = [
  [/^\/channels\/[^/]+/, "/channels/[id]"],
  [/^\/compare\/[^/]+/, "/compare/[id]"],
  [/^\/waitlist\/[^/]+/, "/waitlist/[code]"],
];

/** A path worth counting: no query string, no ids. */
export function cleanPath(path: string): string | null {
  if (!path.startsWith("/") || path.startsWith("/api/")) return null;
  const bare = path.split(/[?#]/)[0]!.slice(0, 200);
  for (const [pattern, name] of ID_ROUTES) if (pattern.test(bare)) return bare.replace(pattern, name);
  return bare;
}

const shortText = (value: unknown, max = 100) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

export interface ClientEvent {
  kind: SiteEventKind;
  path: string;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  creatorCode: string | null;
  refCode: string | null;
  signedIn: boolean;
}

/** A beacon's body, or null when it isn't one we take. */
export function parseClientEvent(body: unknown): ClientEvent | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const kind = CLIENT_EVENT_KINDS.find((k) => k === b.kind);
  const path = typeof b.path === "string" ? cleanPath(b.path) : null;
  if (!kind || !path) return null;
  return {
    kind,
    path,
    referrer: shortText(b.referrer, 500),
    utmSource: shortText(b.utmSource, 60)?.toLowerCase() ?? null,
    utmMedium: shortText(b.utmMedium, 60)?.toLowerCase() ?? null,
    utmCampaign: shortText(b.utmCampaign, 100) ?? null,
    creatorCode: shortText(b.code, 20)?.toLowerCase() ?? null,
    refCode: shortText(b.ref, 16)?.toLowerCase() ?? null,
    signedIn: b.signedIn === true,
  };
}

export interface SiteTraffic {
  visitors: number;
  publicVisitors: number;
  pageviews: number;
  live: number;
  daily: { day: string; visitors: number; pageviews: number; checkouts: number; paid: number }[];
  funnel: { landing: number; pricing: number; checkout: number; subscribed: number; purchases: number; waitlist: number; revenueCents: number };
  pages: { path: string; views: number; visitors: number }[];
  referrers: { name: string; visitors: number }[];
  sources: { name: string; visitors: number; checkouts: number }[];
  devices: Record<string, number>;
}

/** Share of `from` that made it to `to`, as a whole percent; null when nobody started. */
export function conversion(from: number, to: number): number | null {
  if (from <= 0) return null;
  return Math.min(100, Math.round((to / from) * 1000) / 10);
}

/** Every day in the range, so quiet days show as empty bars instead of vanishing. */
export function fillDays(daily: SiteTraffic["daily"], since: Date, until: Date): SiteTraffic["daily"] {
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const days: SiteTraffic["daily"] = [];
  const cursor = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
  while (cursor < until) {
    const day = cursor.toISOString().slice(0, 10);
    days.push(byDay.get(day) ?? { day, visitors: 0, pageviews: 0, checkouts: 0, paid: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}
