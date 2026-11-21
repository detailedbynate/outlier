import type { DatabaseClient } from "@/lib/database/client";
import { assertOk, unwrap } from "@/lib/database/errors";
import type { TablesInsert, VideoBreakdownRow } from "@/types/database";

/** Hundreds of ids in one filter overflow the request URL limit. */
const IDS_PER_REQUEST = 100;

/** Why outlier videos took off, one row per video (supabase/migrations/20261121000043_ai_breakdowns.sql). */
export class VideoBreakdownRepository {
  constructor(private readonly db: DatabaseClient) {}

  async forVideos(ids: string[]): Promise<Map<string, VideoBreakdownRow>> {
    const out = new Map<string, VideoBreakdownRow>();
    for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) {
      const rows = unwrap(await this.db.from("video_breakdowns").select("*").in("video_id", ids.slice(i, i + IDS_PER_REQUEST)), "breakdowns.forVideos");
      for (const row of rows) out.set(row.video_id, row);
    }
    return out;
  }

  /** Of these videos, the ones already broken down. */
  async existing(ids: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) {
      const rows = unwrap(await this.db.from("video_breakdowns").select("video_id").in("video_id", ids.slice(i, i + IDS_PER_REQUEST)), "breakdowns.existing");
      for (const row of rows) out.add(row.video_id);
    }
    return out;
  }

  async save(rows: TablesInsert<"video_breakdowns">[]): Promise<void> {
    if (rows.length === 0) return;
    assertOk(await this.db.from("video_breakdowns").upsert(rows, { onConflict: "video_id" }), "breakdowns.save");
  }

  /** Videos with this style, hook or angle, newest analysis first: the filter on Viral Videos. */
  async videoIdsWhere(filter: { style?: string; hookType?: string; angle?: string }, limit = 2_000): Promise<string[]> {
    let query = this.db.from("video_breakdowns").select("video_id");
    if (filter.style) query = query.eq("style", filter.style);
    if (filter.hookType) query = query.eq("hook_type", filter.hookType);
    if (filter.angle) query = query.eq("angle", filter.angle);
    return unwrap(await query.order("analyzed_at", { ascending: false }).limit(limit), "breakdowns.videoIdsWhere").map((r) => r.video_id);
  }
}
