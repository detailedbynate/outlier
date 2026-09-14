import type { DatabaseClient } from "@/lib/database/client";
import { assertOk, unwrap } from "@/lib/database/errors";
import type { TablesInsert, TrendingPickRow, TrendingPickStatRow } from "@/types/database";

export class TrendingRepository {
  constructor(private readonly db: DatabaseClient) {}

  /** Picks for the most recent pick date, ordered by niche then rank. */
  async latest(): Promise<TrendingPickRow[]> {
    const newest = unwrap(
      await this.db.from("trending_picks").select("pick_date").order("pick_date", { ascending: false }).limit(1),
      "trending_picks.latestDate",
    )[0];
    if (!newest) return [];
    return unwrap(
      await this.db
        .from("trending_picks")
        .select("*")
        .eq("pick_date", newest.pick_date)
        .order("created_at")
        .order("rank"),
      "trending_picks.latest",
    );
  }

  /** Replace a day's picks atomically enough for our use (delete then insert). */
  async replaceForDate(pickDate: string, rows: TablesInsert<"trending_picks">[]): Promise<TrendingPickRow[]> {
    assertOk(await this.db.from("trending_picks").delete().eq("pick_date", pickDate), "trending_picks.clearDate");
    if (rows.length === 0) return [];
    return unwrap(await this.db.from("trending_picks").insert(rows).select("*"), "trending_picks.insert");
  }

  async clearAll(): Promise<void> {
    assertOk(await this.db.from("trending_picks").delete().not("id", "is", null), "trending_picks.clearAll");
  }

  async deletePick(id: string): Promise<void> {
    assertOk(await this.db.from("trending_picks").delete().eq("id", id), "trending_picks.delete");
  }

  async updatePick(id: string, patch: Partial<TrendingPickRow>): Promise<void> {
    assertOk(await this.db.from("trending_picks").update(patch).eq("id", id), "trending_picks.update");
  }

  async insertStats(rows: TablesInsert<"trending_pick_stats">[]): Promise<void> {
    if (rows.length === 0) return;
    assertOk(
      await this.db.from("trending_pick_stats").upsert(rows, { onConflict: "pick_id,captured_at", ignoreDuplicates: true }),
      "trending_pick_stats.insert",
    );
  }

  async statsSince(pickIds: string[], since: Date): Promise<TrendingPickStatRow[]> {
    if (pickIds.length === 0) return [];
    return unwrap(
      await this.db
        .from("trending_pick_stats")
        .select("*")
        .in("pick_id", pickIds)
        .gte("captured_at", since.toISOString())
        .order("captured_at"),
      "trending_pick_stats.since",
    );
  }

  async pruneStats(olderThan: Date): Promise<void> {
    assertOk(await this.db.from("trending_pick_stats").delete().lt("captured_at", olderThan.toISOString()), "trending_pick_stats.prune");
  }
}
