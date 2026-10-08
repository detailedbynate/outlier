import { createHash } from "node:crypto";

/**
 * First-party site traffic. A visitor is counted by a random id in a
 * first-party cookie (VISITOR_COOKIE), stored only as a salted hash, so the
 * same person is one visitor across days. When the browser blocks cookies it
 * falls back to a hash of IP, browser and the day: one visitor per day, and
 * never traceable back to the IP.
 */

/** Holds a random id, nothing else. Set by proxy.ts on the first page visit. */
export const VISITOR_COOKIE = "outlier_vid";
/** Set when someone opts out of being counted (/api/track/opt-out). */
export const NO_TRACK_COOKIE = "outlier_notrack";
const VISITOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "engagement" is sent when someone leaves a page or switches tab: how long it
// was on screen and how far they scrolled. It never starts a visit; it only
// tells how long the visit lasted (the way Plausible measures time on page).
export const SITE_EVENT_KINDS = ["pageview", "engagement", "pricing_view", "checkout_start", "subscribed", "purchase", "waitlist_join"] as const;
export type SiteEventKind = (typeof SITE_EVENT_KINDS)[number];
/** What the browser may report; the rest only the server records. */
export const CLIENT_EVENT_KINDS: readonly SiteEventKind[] = ["pageview", "engagement", "pricing_view"];

const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|embedly|curl|wget|python|httpclient|axios|node-fetch|go-http|monitor|uptime/i;

export function isBot(userAgent: string | null): boolean {
  return !userAgent || BOT.test(userAgent);
}

/** The visitor from their cookie id, when they have a valid one. */
export function persistentVisitorId(cookieId: string | null | undefined, salt: string): string | null {
  if (!cookieId || !VISITOR_ID.test(cookieId)) return null;
  return createHash("sha256").update(`vid|${cookieId.toLowerCase()}|${salt}`).digest("hex").slice(0, 20);
}

/** One cookie's value out of a Cookie header. */
export function cookieFrom(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
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

// Sites people arrive from, by platform. Checked against the referrer's host, in
// order: the AI assistants and webmail that live on google.com etc. come first.
const PLATFORM_HOSTS: [RegExp, string][] = [
  [/^gemini\.google\.com$|^bard\.google\.com$/, "Gemini"],
  [/^copilot\.microsoft\.com$/, "Copilot"],
  [/^mail\.google\.com$|^com\.google\.android\.gm$|(^|\.)outlook\.(live|office)\.com$|^mail\.yahoo\.com$|(^|\.)proton\.me$|^mail\.proton\.me$/, "Email"],
  [/(^|\.)youtube\.com$|^youtu\.be$/, "YouTube"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)facebook\.com$|^fb\.(me|com)$|(^|\.)messenger\.com$/, "Facebook"],
  [/^t\.co$|(^|\.)twitter\.com$|(^|\.)x\.com$/, "X (Twitter)"],
  [/(^|\.)threads\.(net|com)$/, "Threads"],
  [/(^|\.)reddit\.com$|^redd\.it$/, "Reddit"],
  [/(^|\.)discord(app)?\.com$|^discord\.gg$/, "Discord"],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, "LinkedIn"],
  [/(^|\.)snapchat\.com$/, "Snapchat"],
  [/(^|\.)twitch\.tv$/, "Twitch"],
  [/(^|\.)pinterest\.[a-z.]+$|^pin\.it$/, "Pinterest"],
  [/(^|\.)vimeo\.com$/, "Vimeo"],
  [/(^|\.)kick\.com$/, "Kick"],
  [/(^|\.)google\.[a-z.]+$|^com\.google\.android\.googlequicksearchbox$/, "Google"],
  [/(^|\.)bing\.com$/, "Bing"],
  [/(^|\.)duckduckgo\.com$/, "DuckDuckGo"],
  [/(^|\.)search\.yahoo\.com$|^yahoo\.com$/, "Yahoo"],
  [/(^|\.)ecosia\.org$/, "Ecosia"],
  [/^search\.brave\.com$/, "Brave Search"],
  [/(^|\.)yandex\.[a-z.]+$/, "Yandex"],
  [/(^|\.)baidu\.com$/, "Baidu"],
  [/(^|\.)chatgpt\.com$|^chat\.openai\.com$/, "ChatGPT"],
  [/(^|\.)perplexity\.ai$/, "Perplexity"],
  [/(^|\.)claude\.ai$/, "Claude"],
  [/(^|\.)deepseek\.com$/, "DeepSeek"],
  [/(^|\.)grok\.com$/, "Grok"],
];

// Apps that open links in their own browser, often without saying where from.
const IN_APP_BROWSERS: [RegExp, string][] = [
  [/Instagram/, "Instagram"],
  [/FBAN|FBAV|FB_IAB|FBIOS/, "Facebook"],
  [/musical_ly|BytedanceWebview|TikTok/i, "TikTok"],
  [/Snapchat/, "Snapchat"],
  [/LinkedInApp/, "LinkedIn"],
  [/Discord/, "Discord"],
];

// What people tag their links with (?utm_source=yt), by platform.
const UTM_NAMES: [RegExp, string][] = [
  [/^(youtube|yt|youtube[-_ ]?shorts|shorts|youtube\.com)$/, "YouTube"],
  [/^(tiktok|tt|tiktok\.com)$/, "TikTok"],
  [/^(instagram|ig|insta|instagram\.com)$/, "Instagram"],
  [/^(facebook|fb|facebook\.com)$/, "Facebook"],
  [/^(twitter|x|x\.com|twitter\.com)$/, "X (Twitter)"],
  [/^(threads)$/, "Threads"],
  [/^(discord)$/, "Discord"],
  [/^(reddit)$/, "Reddit"],
  [/^(linkedin)$/, "LinkedIn"],
  [/^(snapchat|snap)$/, "Snapchat"],
  [/^(twitch)$/, "Twitch"],
  [/^(pinterest)$/, "Pinterest"],
  [/^(google)$/, "Google"],
  [/^(bing)$/, "Bing"],
  [/^(chatgpt|chatgpt\.com|openai)$/, "ChatGPT"],
  [/^(perplexity)$/, "Perplexity"],
  [/^(e-?mail|newsletter)$/, "Email"],
];

// Platform kinds, for the channel a visit counts under (as in GA4's source categories).
const SEARCH = new Set(["Google", "Bing", "DuckDuckGo", "Yahoo", "Ecosia", "Brave Search", "Yandex", "Baidu"]);
const SOCIAL = new Set(["TikTok", "Instagram", "Facebook", "X (Twitter)", "Threads", "Reddit", "Discord", "LinkedIn", "Snapchat", "Pinterest"]);
const VIDEO = new Set(["YouTube", "Twitch", "Vimeo", "Kick"]);
const AI = new Set(["ChatGPT", "Perplexity", "Claude", "Gemini", "Copilot", "DeepSeek", "Grok"]);

export const CHANNELS = [
  "Direct",
  "Creator codes",
  "Referral links",
  "Paid search",
  "Paid social",
  "Paid video",
  "Paid other",
  "Display",
  "Organic video",
  "Organic social",
  "Organic search",
  "AI assistants",
  "Email",
  "Affiliates",
  "Referral",
] as const;
export type Channel = (typeof CHANNELS)[number];

const PAID_MEDIUM = /^(.*cp.*|ppc|retargeting|paid.*)$/;
const DISPLAY_MEDIUM = /^(display|banner|expandable|interstitial|cpm)$/;
const SOCIAL_MEDIUM = /^(social|social[-_ ]?network|social[-_ ]?media|sm|organic[-_ ]?social)$/;
const EMAIL_MEDIUM = /^(e[-_ ]?mail|newsletter)$/;

/**
 * The channel a visit came in on, by GA4's default channel rules: checked in
 * order, first match wins, from the link's tags (utm_medium) and the platform.
 * Two of Outlier's own come first, since they're how creators and friends
 * send people. Plus "AI assistants", which GA4 lumps in with Referral.
 * Null is a direct visit: no link tag, no referring site.
 */
export function channelOf(input: {
  platform: string | null;
  utmMedium: string | null;
  creatorCode: string | null;
  refCode: string | null;
}): Channel | null {
  const medium = input.utmMedium?.trim().toLowerCase() ?? "";
  const platform = input.platform;
  if (input.creatorCode) return "Creator codes";
  if (input.refCode) return "Referral links";
  if (PAID_MEDIUM.test(medium)) {
    if (platform && SEARCH.has(platform)) return "Paid search";
    if (platform && SOCIAL.has(platform)) return "Paid social";
    if (platform && VIDEO.has(platform)) return "Paid video";
    return "Paid other";
  }
  if (DISPLAY_MEDIUM.test(medium)) return "Display";
  if ((platform && VIDEO.has(platform)) || medium.includes("video")) return "Organic video";
  if ((platform && SOCIAL.has(platform)) || SOCIAL_MEDIUM.test(medium)) return "Organic social";
  if ((platform && SEARCH.has(platform)) || medium === "organic") return "Organic search";
  if (platform && AI.has(platform)) return "AI assistants";
  if (platform === "Email" || EMAIL_MEDIUM.test(medium)) return "Email";
  if (medium === "affiliate") return "Affiliates";
  return platform || medium ? "Referral" : null;
}

/**
 * The platform a visit came from: what the link was tagged with, else the
 * site that linked here, else the app whose browser it opened in. Null means
 * direct (typed in, a bookmark, or an app that hid where it came from).
 */
export function platformOf(input: { referrerHost: string | null; utmSource: string | null; userAgent: string | null }): string | null {
  const utm = input.utmSource?.trim().toLowerCase();
  if (utm) return UTM_NAMES.find(([pattern]) => pattern.test(utm))?.[1] ?? utm.slice(0, 40);
  const host = input.referrerHost;
  if (host) return PLATFORM_HOSTS.find(([pattern]) => pattern.test(host))?.[1] ?? host.replace(/^(m|l|lm|mobile)\./, "");
  const ua = input.userAgent ?? "";
  return IN_APP_BROWSERS.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
}

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
  /** Engagement events only: time on screen and how far down the page. */
  engagedMs: number | null;
  scrollPercent: number | null;
}

const bounded = (value: unknown, max: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), max) : null;

/** A beacon's body, or null when it isn't one we take. */
export function parseClientEvent(body: unknown): ClientEvent | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const kind = CLIENT_EVENT_KINDS.find((k) => k === b.kind);
  const path = typeof b.path === "string" ? cleanPath(b.path) : null;
  if (!kind || !path) return null;
  const engagedMs = kind === "engagement" ? bounded(b.engagedMs, 30 * 60_000) : null;
  // An engagement ping with nothing in it isn't worth a row.
  if (kind === "engagement" && !engagedMs) return null;
  return {
    kind,
    path,
    referrer: shortText(b.referrer, 500),
    // ?source= works too, as on Plausible: people tag links whichever way they know.
    utmSource: (shortText(b.utmSource, 60) ?? shortText(b.source, 60))?.toLowerCase() ?? null,
    utmMedium: shortText(b.utmMedium, 60)?.toLowerCase() ?? null,
    utmCampaign: shortText(b.utmCampaign, 100) ?? null,
    creatorCode: shortText(b.code, 20)?.toLowerCase() ?? null,
    refCode: shortText(b.ref, 16)?.toLowerCase() ?? null,
    signedIn: b.signedIn === true,
    engagedMs,
    scrollPercent: kind === "engagement" ? bounded(b.scroll, 100) : null,
  };
}

export interface TrafficChannelRow {
  name: string;
  visits: number;
  visitors: number;
  bounceRate: number | null;
  checkouts: number;
  paid: number;
  revenueCents: number;
}

export interface SiteTraffic {
  visitors: number;
  publicVisitors: number;
  newVisitors: number;
  /** Visits: a visitor's page views with no gap of 30 minutes or more between them. */
  visits: number;
  /** Share of visits that saw one page and left. */
  bounceRate: number | null;
  /** Average visit length in seconds; a bounce counts as 0. */
  avgVisitSeconds: number;
  pageviews: number;
  live: number;
  daily: { day: string; visitors: number; pageviews: number; checkouts: number; paid: number }[];
  funnel: { landing: number; pricing: number; checkout: number; subscribed: number; purchases: number; waitlist: number; revenueCents: number };
  pages: { path: string; views: number; visitors: number; avgSeconds: number | null; scroll: number | null }[];
  entryPages: { path: string; visits: number; bounceRate: number | null }[];
  channels: TrafficChannelRow[];
  platforms: TrafficChannelRow[];
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
