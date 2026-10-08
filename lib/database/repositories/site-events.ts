import type { DatabaseClient } from "@/lib/database/client";
import { toDatabaseError, unwrap } from "@/lib/database/errors";
import type { SiteTraffic } from "@/lib/analytics/site";
import type { TablesInsert } from "@/types/database";

export class SiteEventRepository {
  constructor(private readonly db: DatabaseClient) {}

  /** Record one event; one with a dedupe key already seen is skipped. */
  async record(row: TablesInsert<"site_events">): Promise<void> {
    const result = await this.db.from("site_events").insert(row);
    if (result.error && result.error.code !== "23505") throw toDatabaseError(result.error, "siteEvents.record");
  }

  async traffic(since: Date, until: Date): Promise<SiteTraffic> {
    const data = unwrap(await this.db.rpc("site_traffic", { p_since: since.toISOString(), p_until: until.toISOString() }), "siteEvents.traffic");
    return data as unknown as SiteTraffic;
  }
}
