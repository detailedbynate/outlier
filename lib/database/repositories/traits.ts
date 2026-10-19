import type { DatabaseClient } from "@/lib/database/client";
import { assertOk, unwrap } from "@/lib/database/errors";
import type { ChannelTraitRow } from "@/types/database";

/** Hundreds of ids in one filter overflow the request URL limit. */
const IDS_PER_REQUEST = 100;

/** Per-channel badges: faceless, and the views behind YPP eligibility (supabase/migrations/20261019000040_channel_traits.sql). */
export class ChannelTraitRepository {
  constructor(private readonly db: DatabaseClient) {}

  async dueForFacelessCheck(limit: number, staleBefore: Date): Promise<string[]> {
    return unwrap(await this.db.rpc("channels_for_faceless_check", { batch_size: limit, stale_before: staleBefore.toISOString() }), "traits.dueFaceless");
  }

  async saveFaceless(rows: { channelId: string; faceless: boolean | null; model: string }[], at: Date): Promise<void> {
    if (rows.length === 0) return;
    assertOk(
      await this.db.from("channel_traits").upsert(
        rows.map((r) => ({ channel_id: r.channelId, faceless: r.faceless, model: r.model, faceless_checked_at: at.toISOString() })),
        { onConflict: "channel_id" },
      ),
      "traits.saveFaceless",
    );
  }

  async forChannels(ids: string[]): Promise<Map<string, ChannelTraitRow>> {
    const out = new Map<string, ChannelTraitRow>();
    for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) {
      const rows = unwrap(await this.db.from("channel_traits").select("*").in("channel_id", ids.slice(i, i + IDS_PER_REQUEST)), "traits.forChannels");
      for (const row of rows) out.set(row.channel_id, row);
    }
    return out;
  }

  /** Channels judged faceless (true) or on camera (false). */
  async idsWhereFaceless(faceless: boolean, limit = 5_000): Promise<string[]> {
    return unwrap(await this.db.from("channel_traits").select("channel_id").eq("faceless", faceless).limit(limit), "traits.idsWhereFaceless").map((r) => r.channel_id);
  }

  async shortsViews90d(ids: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) {
      const rows = unwrap(await this.db.rpc("channel_shorts_views_90d", { ids: ids.slice(i, i + IDS_PER_REQUEST) }), "traits.shortsViews90d");
      for (const row of rows) out.set(row.channel_id, Number(row.views));
    }
    return out;
  }
}
