import "server-only";
import { headers } from "next/headers";
import { env } from "@/lib/core/env";
import { logger } from "@/lib/core/logger";
import { getServices } from "@/lib/services";
import { clientIpFrom } from "@/lib/services/rate-limit-service";
import { deviceOf, isBot, visitorId, type SiteEventKind } from "./site";
import type { TablesInsert } from "@/types/database";

const log = logger.child({ module: "analytics.site" });

export function trafficSalt(): string {
  const config = env();
  return config.RATE_LIMIT_SALT ?? config.CRON_SECRET ?? "outlier-traffic";
}

/** The anonymous visitor id for this request, matching what the page tracker records. */
export function visitorFrom(h: Pick<Headers, "get">, now = new Date()): string | null {
  const userAgent = h.get("user-agent");
  if (isBot(userAgent)) return null;
  return visitorId({ ip: clientIpFrom(h), userAgent: userAgent!, salt: trafficSalt(), now });
}

export function deviceFrom(h: Pick<Headers, "get">): string | null {
  const userAgent = h.get("user-agent");
  return userAgent ? deviceOf(userAgent) : null;
}

/**
 * Record something that happened on the server (a checkout started, a payment
 * landed). Never throws: a missed count must not fail a checkout.
 */
export async function recordSiteEvent(
  kind: SiteEventKind,
  extra: Omit<TablesInsert<"site_events">, "kind"> = {},
  options: { fromRequest?: boolean } = { fromRequest: true },
): Promise<void> {
  try {
    let fromRequest: Partial<TablesInsert<"site_events">> = {};
    if (options.fromRequest !== false) {
      const h = await headers();
      fromRequest = { visitor: visitorFrom(h), device: deviceFrom(h) };
    }
    await getServices().repositories.siteEvents.record({ ...fromRequest, ...extra, kind });
  } catch (error) {
    log.warn("site event not recorded", { kind, error: error instanceof Error ? error.message : String(error) });
  }
}
