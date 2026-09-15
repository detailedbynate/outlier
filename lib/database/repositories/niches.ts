import type { DatabaseClient } from "@/lib/database/client";
import { assertOk, unwrap } from "@/lib/database/errors";
import type { NicheChannel, NicheVideo } from "@/lib/niches/analysis";
import type { NicheReportRow, TablesInsert } from "@/types/database";

const escapePattern = (value: string) => value.replace(/[\\%_*,()"]/g, " ").trim();

export class NicheRepository {
  constructor(private readonly db: DatabaseClient) {}

  async getReport(topicKey: string): Promise<NicheReportRow | null> {
    const rows = unwrap(await this.db.from("niche_reports").select("*").eq("topic_key", topicKey).limit(1), "niche_reports.get");
    return rows[0] ?? null;
  }

  async saveReport(row: TablesInsert<"niche_reports">): Promise<void> {
    assertOk(await this.db.from("niche_reports").upsert(row, { onConflict: "topic_key" }), "niche_reports.save");
  }

  /** Atomic: true for exactly one caller while the topic is stale and unclaimed. */
  async claimRefresh(topicKey: string, topic: string, staleBefore: Date, lockSeconds: number): Promise<boolean> {
    return unwrap(
      await this.db.rpc("claim_niche_refresh", { p_topic_key: topicKey, p_topic: topic, p_stale_before: staleBefore.toISOString(), p_lock_seconds: lockSeconds }),
      "niche_reports.claim",
    );
  }

  async releaseClaim(topicKey: string): Promise<void> {
    assertOk(await this.db.from("niche_reports").update({ refresh_claimed_at: null }).eq("topic_key", topicKey), "niche_reports.release");
  }

  async popularTopics(limit: number): Promise<{ topic: string; search_count: number }[]> {
    return unwrap(
      await this.db.from("niche_reports").select("topic, search_count").gt("search_count", 0).order("search_count", { ascending: false }).limit(limit),
      "niche_reports.popular",
    );
  }

  /**
   * Stored videos about a topic from the last `days`: titles mentioning it, plus
   * uploads from channels whose name or description mentions it.
   */
  async topicSample(topic: string, since: Date, limit = 1_500): Promise<{ videos: NicheVideo[]; channels: Map<string, NicheChannel> }> {
    const term = escapePattern(topic);
    if (term.length < 2) return { videos: [], channels: new Map() };
    const columns = "id, youtube_video_id, channel_id, title, tags, format, view_count, like_count, comment_count, published_at";

    const matchingChannels = unwrap(
      await this.db.from("channels").select("id").or(`title.ilike."*${term}*",description.ilike."*${term}*",keywords.cs.{"${term}"}`).limit(300),
      "niches.topicChannels",
    ).map((c) => c.id);

    const byTitle = unwrap(
      await this.db.from("videos").select(columns).ilike("title", `%${term}%`).gte("published_at", since.toISOString()).order("view_count", { ascending: false }).limit(limit),
      "niches.videosByTitle",
    );
    const byChannel = matchingChannels.length
      ? unwrap(
          await this.db.from("videos").select(columns).in("channel_id", matchingChannels).gte("published_at", since.toISOString()).order("view_count", { ascending: false }).limit(limit),
          "niches.videosByChannel",
        )
      : [];

    const byId = new Map<string, Omit<NicheVideo, "outlier_score">>();
    for (const row of [...byTitle, ...byChannel]) byId.set(row.id, row);
    const ids = [...byId.keys()];

    const scores = new Map<string, number>();
    for (let i = 0; i < ids.length; i += 200) {
      const rows = unwrap(
        await this.db.from("video_performance").select("video_id, outlier_score").in("video_id", ids.slice(i, i + 200)),
        "niches.performance",
      );
      for (const r of rows) if (r.outlier_score !== null) scores.set(r.video_id, Number(r.outlier_score));
    }

    const channelIds = [...new Set([...byId.values()].map((v) => v.channel_id))];
    const channels = new Map<string, NicheChannel>();
    for (let i = 0; i < channelIds.length; i += 200) {
      const rows = unwrap(
        await this.db.from("channels").select("id, youtube_channel_id, title, thumbnail_url, subscriber_count").in("id", channelIds.slice(i, i + 200)),
        "niches.channels",
      );
      for (const r of rows) channels.set(r.id, r);
    }

    return {
      videos: [...byId.values()].map((v) => ({ ...v, tags: v.tags ?? [], outlier_score: scores.get(v.id) ?? null })),
      channels,
    };
  }
}
