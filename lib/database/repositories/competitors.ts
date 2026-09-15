import type { DatabaseClient } from "@/lib/database/client";
import { assertOk, unwrap } from "@/lib/database/errors";
import type { IntelVideo } from "@/lib/competitors/intel";

const VIDEO_COLUMNS =
  "id, youtube_video_id, channel_id, title, tags, format, duration_seconds, thumbnail_url, view_count, like_count, comment_count, published_at, views_per_hour, view_acceleration";

type VideoBase = Omit<IntelVideo, "outlier_score" | "engagement_rate">;

/** Read-only competitor data: stored uploads joined with their computed performance. */
export class CompetitorRepository {
  constructor(private readonly db: DatabaseClient) {}

  /** Uploads for channels since a time, newest first, with outlier score and engagement. */
  async videosForChannels(channelIds: string[], since: Date, limit = 2_000): Promise<IntelVideo[]> {
    if (channelIds.length === 0) return [];
    const rows = unwrap(
      await this.db
        .from("videos")
        .select(VIDEO_COLUMNS)
        .in("channel_id", channelIds)
        .gte("published_at", since.toISOString())
        .in("format", ["short", "long_form"])
        .order("published_at", { ascending: false })
        .limit(limit),
      "competitors.videos",
    ) as VideoBase[];
    return this.withPerformance(rows);
  }

  /** A channel's most-viewed stored uploads (all time). */
  async topVideos(channelId: string, limit = 10): Promise<IntelVideo[]> {
    const rows = unwrap(
      await this.db.from("videos").select(VIDEO_COLUMNS).eq("channel_id", channelId).order("view_count", { ascending: false }).limit(limit),
      "competitors.topVideos",
    ) as VideoBase[];
    return this.withPerformance(rows);
  }

  async alertSettings(userId: string): Promise<string[] | null> {
    const rows = unwrap(await this.db.from("user_preferences").select("competitor_alerts").eq("user_id", userId).limit(1), "competitors.alertSettings");
    return rows[0]?.competitor_alerts ?? null;
  }

  async saveAlertSettings(userId: string, kinds: string[]): Promise<void> {
    assertOk(await this.db.from("user_preferences").update({ competitor_alerts: kinds }).eq("user_id", userId), "competitors.saveAlertSettings");
  }

  private async withPerformance(rows: VideoBase[]): Promise<IntelVideo[]> {
    const performance = new Map<string, { outlier_score: number | null; engagement_rate: number | null }>();
    const ids = rows.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = unwrap(
        await this.db.from("video_performance").select("video_id, outlier_score, engagement_rate").in("video_id", ids.slice(i, i + 200)),
        "competitors.performance",
      );
      for (const p of chunk) performance.set(p.video_id, { outlier_score: p.outlier_score, engagement_rate: p.engagement_rate });
    }
    return rows.map((r) => ({
      ...r,
      tags: r.tags ?? [],
      outlier_score: performance.get(r.id)?.outlier_score ?? null,
      engagement_rate: performance.get(r.id)?.engagement_rate ?? null,
    }));
  }
}
