import type { DatabaseClient } from "@/lib/database/client";
import { toDatabaseError, unwrap } from "@/lib/database/errors";
import type { SiteTraffic } from "@/lib/analytics/site";
import type { TablesInsert } from "@/types/database";

const EMPTY: SiteTraffic = {
  visitors: 0,
  publicVisitors: 0,
  newVisitors: 0,
  visits: 0,
  bounceRate: null,
  avgVisitSeconds: 0,
  pageviews: 0,
  live: 0,
  daily: [],
  pages: [],
  entryPages: [],
  channels: [],
  platforms: [],
  sources: [],
  devices: {},
  funnel: { landing: 0, pricing: 0, checkout: 0, subscribed: 0, purchases: 0, waitlist: 0, revenueCents: 0 },
};

export class SiteEventRepository {
  constructor(private readonly db: DatabaseClient) {}

  /** Record one event; one with a dedupe key already seen is skipped. */
  async record(row: TablesInsert<"site_events">): Promise<void> {
    const result = await this.db.from("site_events").insert(row);
    if (result.error && result.error.code !== "23505") throw toDatabaseError(result.error, "siteEvents.record");
  }

  async traffic(since: Date, until: Date): Promise<SiteTraffic> {
    const data = unwrap(await this.db.rpc("site_traffic", { p_since: since.toISOString(), p_until: until.toISOString() }), "siteEvents.traffic");
    // Fields added by later migrations default to empty, so the page still loads before one is applied.
    return { ...EMPTY, ...(data as unknown as Partial<SiteTraffic>) };
  }
}
