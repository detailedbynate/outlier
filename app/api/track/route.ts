import { deviceFrom, visitorFrom } from "@/lib/analytics/site-events";
import { channelOf, cookieFrom, NO_TRACK_COOKIE, parseClientEvent, platformOf, referrerHost, sourceOf } from "@/lib/analytics/site";
import { logger } from "@/lib/core/logger";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

// One visitor can't flood the table: at most this many events a minute each.
const PER_MINUTE = 60;
const recent = new Map<string, { minute: number; count: number }>();

function throttled(visitor: string, now: number): boolean {
  const minute = Math.floor(now / 60_000);
  const entry = recent.get(visitor);
  if (!entry || entry.minute !== minute) {
    if (recent.size > 20_000) recent.clear();
    recent.set(visitor, { minute, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > PER_MINUTE;
}

/** POST /api/track — page views from the page tracker. Always answers 204. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.text();
    if (body.length > 4_000) return done();
    if (cookieFrom(request.headers.get("cookie"), NO_TRACK_COOKIE)) return done();
    const event = parseClientEvent(JSON.parse(body));
    const visitor = visitorFrom(request.headers);
    if (!event || !visitor || throttled(visitor, Date.now())) return done();

    const referrer = referrerHost(event.referrer, request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
    // Where a visit came from is decided by its page views; the database counts
    // it once, at the start of the visit.
    const userAgent = request.headers.get("user-agent");
    const platform = platformOf({ referrerHost: referrer, utmSource: event.utmSource, userAgent });
    const source = event.kind === "pageview" ? sourceOf({ referrerHost: referrer, utmSource: event.utmSource, userAgent, creatorCode: event.creatorCode, refCode: event.refCode }) : null;
    await getServices().repositories.siteEvents.record({
      kind: event.kind,
      visitor,
      signed_in: event.signedIn,
      path: event.path,
      referrer_host: referrer,
      source,
      channel: event.kind === "pageview" ? channelOf({ platform, utmMedium: event.utmMedium, creatorCode: event.creatorCode, refCode: event.refCode }) : null,
      engaged_ms: event.engagedMs,
      scroll_pct: event.scrollPercent,
      utm_source: event.utmSource,
      utm_medium: event.utmMedium,
      utm_campaign: event.utmCampaign,
      creator_code: event.creatorCode,
      ref_code: event.refCode,
      device: deviceFrom(request.headers),
    });
  } catch (error) {
    logger.debug("track event dropped", { error: error instanceof Error ? error.message : String(error) });
  }
  return done();
}

const done = () => new Response(null, { status: 204 });
