import type { DatabaseClient } from "@/lib/database/client";
import { assertOk, unwrap } from "@/lib/database/errors";
import type { NicheChannel, NicheVideo } from "@/lib/niches/analysis";
import type { NicheReportRow, NicheRow, TablesInsert } from "@/types/database";

const escapePattern = (value: string) => value.replace(/[\\%_*,()"]/g, " ").trim();

/** Channels with these flags don't feed niche analysis: their numbers come from other people's work. */
const EXCLUDED_FLAGS = new Set(["reupload", "compilation", "spam_or_misleading"]);

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

  /**
   * Find or create a niche entity by slug; merges new aliases into existing ones.
   * Returns the entity id.
   */
  async upsertEntity(entity: { slug: string; name: string; kind: NicheRow["kind"]; parentId: string | null; aliases: string[] }): Promise<string> {
    const existing = unwrap(await this.db.from("niches").select("id, keywords, parent_id").eq("slug", entity.slug).limit(1), "niches.findEntity")[0];
    if (existing) {
      const merged = [...new Set([...existing.keywords, ...entity.aliases])].slice(0, 30);
      const needsUpdate = merged.length !== existing.keywords.length || (!existing.parent_id && entity.parentId);
      if (needsUpdate) {
        assertOk(
          await this.db
            .from("niches")
            .update({ keywords: merged, ...(existing.parent_id ? {} : { parent_id: entity.parentId }) })
            .eq("id", existing.id),
          "niches.mergeEntity",
        );
      }
      return existing.id;
    }
    const inserted = await this.db
      .from("niches")
      .insert({ slug: entity.slug, name: entity.name, kind: entity.kind, parent_id: entity.parentId, keywords: entity.aliases.slice(0, 30) })
      .select("id")
      .single();
    // Another labeling run created it first.
    if (inserted.error?.code === "23505") return this.upsertEntity(entity);
    return unwrap(inserted, "niches.insertEntity").id;
  }

  async refreshChannelCounts(): Promise<void> {
    assertOk(await this.db.rpc("refresh_niche_channel_counts"), "niches.refreshCounts");
  }

  /** Channel counts per entity slug, for picking which niches the library is thin on. */
  async channelCountsBySlug(slugs: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (let i = 0; i < slugs.length; i += 200) {
      const rows = unwrap(
        await this.db.from("niches").select("slug, channel_count").in("slug", slugs.slice(i, i + 200)),
        "niches.countsBySlug",
      );
      for (const row of rows) counts.set(row.slug, row.channel_count);
    }
    return counts;
  }

  async popularTopics(limit: number): Promise<{ topic: string; search_count: number }[]> {
    return unwrap(
      await this.db.from("niche_reports").select("topic, search_count").gt("search_count", 0).order("search_count", { ascending: false }).limit(limit),
      "niche_reports.popular",
    );
  }

  private async pageOfVideos(since: Date, from: number, to: number) {
    return unwrap(
      await this.db
        .from("videos")
        .select("id, youtube_video_id, channel_id, title, tags, format, view_count, like_count, comment_count, published_at")
        .gte("published_at", since.toISOString())
        .order("published_at", { ascending: false })
        .range(from, to),
      "niches.recentSample",
    );
  }

  /** Channels labeled with a game/topic or sub-niche matching the term. */
  private async labeledChannelIds(term: string): Promise<string[]> {
    const clean = term.toLowerCase();
    const entities = unwrap(
      await this.db.from("niches").select("id").or(`name.ilike."*${clean}*",keywords.cs.{"${clean}"}`).neq("kind", "category").limit(50),
      "niches.labeledEntities",
    ).map((n) => n.id);
    const ids = new Set<string>();
    if (entities.length > 0) {
      for (const row of unwrap(await this.db.from("channels").select("id").in("niche_id", entities).limit(300), "niches.labeledByEntity")) ids.add(row.id);
    }
    for (const row of unwrap(await this.db.from("channels").select("id").overlaps("niche_labels", [clean]).limit(300), "niches.labeledBySub")) ids.add(row.id);
    return [...ids];
  }

  /**
   * Channels for a sample, with their niche terms. Channels flagged as reuploads,
   * compilations or spam are left out entirely.
   */
  private async loadChannels(ids: string[]): Promise<Map<string, NicheChannel>> {
    const channels = new Map<string, NicheChannel>();
    const entityIds = new Set<string>();
    const rows: {
      id: string;
      youtube_channel_id: string;
      title: string;
      thumbnail_url: string | null;
      subscriber_count: number | null;
      niche_id: string | null;
      niche_labels: string[];
      quality_flags: string[];
      niche_confidence: number | null;
    }[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const found = unwrap(
        await this.db
          .from("channels")
          .select("id, youtube_channel_id, title, thumbnail_url, subscriber_count, niche_id, niche_labels, quality_flags, niche_confidence")
          .in("id", ids.slice(i, i + 200)),
        "niches.sampleChannels",
      );
      for (const row of found) {
        if (row.quality_flags.some((flag) => EXCLUDED_FLAGS.has(flag))) continue;
        rows.push(row);
        if (row.niche_id) entityIds.add(row.niche_id);
      }
    }

    const names = new Map<string, string>();
    const entityList = [...entityIds];
    for (let i = 0; i < entityList.length; i += 200) {
      const found = unwrap(await this.db.from("niches").select("id, name, kind").in("id", entityList.slice(i, i + 200)), "niches.entityNames");
      // Categories are too broad to be a niche term.
      for (const entity of found) if (entity.kind !== "category") names.set(entity.id, entity.name);
    }

    for (const row of rows) {
      const entity = row.niche_id ? names.get(row.niche_id) : undefined;
      // Unsure labels help search, but only confident ones steer niche analysis.
      const confident = (row.niche_confidence ?? 0) >= 0.6;
      const nicheTerms = confident ? [...(entity ? [entity.toLowerCase()] : []), ...row.niche_labels] : [];
      channels.set(row.id, {
        id: row.id,
        youtube_channel_id: row.youtube_channel_id,
        title: row.title,
        thumbnail_url: row.thumbnail_url,
        subscriber_count: row.subscriber_count,
        ...(nicheTerms.length > 0 ? { niche_terms: nicheTerms } : {}),
      });
    }
    return channels;
  }

  /** A slice of the whole library to mine for niches, newest uploads first. */
  async recentSample(since: Date, limit = 2_000): Promise<{ videos: NicheVideo[]; channels: Map<string, NicheChannel> }> {
    // PostgREST caps a response at 1000 rows, so page until we have the sample.
    const rows: Awaited<ReturnType<typeof this.pageOfVideos>> = [];
    for (let from = 0; from < limit; from += 1_000) {
      const page = await this.pageOfVideos(since, from, Math.min(from + 999, limit - 1));
      rows.push(...page);
      if (page.length < 1_000) break;
    }
    if (rows.length === 0) return { videos: [], channels: new Map() };

    const ids = rows.map((row) => row.id);
    const scores = new Map<string, number>();
    for (let i = 0; i < ids.length; i += 200) {
      const perf = unwrap(
        await this.db.from("video_performance").select("video_id, outlier_score").in("video_id", ids.slice(i, i + 200)),
        "niches.samplePerformance",
      );
      for (const row of perf) if (row.outlier_score !== null) scores.set(row.video_id, Number(row.outlier_score));
    }

    const channels = await this.loadChannels([...new Set(rows.map((row) => row.channel_id))]);

    return {
      videos: rows.filter((row) => channels.has(row.channel_id)).map((row) => ({ ...row, tags: row.tags ?? [], outlier_score: scores.get(row.id) ?? null })),
      channels,
    };
  }

  /** Recently researched topics with their reports, for the top-niches board and related suggestions. */
  async recentReports(limit: number): Promise<Pick<NicheReportRow, "topic" | "topic_key" | "report" | "videos_analyzed" | "channels_analyzed" | "computed_at" | "search_count">[]> {
    return unwrap(
      await this.db
        .from("niche_reports")
        .select("topic, topic_key, report, videos_analyzed, channels_analyzed, computed_at, search_count")
        .not("computed_at", "is", null)
        .order("last_searched_at", { ascending: false })
        .limit(limit),
      "niche_reports.recent",
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

    const byText = unwrap(
      await this.db.from("channels").select("id").or(`title.ilike."*${term}*",description.ilike."*${term}*",keywords.cs.{"${term}"}`).limit(300),
      "niches.topicChannels",
    ).map((c) => c.id);
    const matchingChannels = [...new Set([...(await this.labeledChannelIds(term)), ...byText])].slice(0, 400);

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

    const channels = await this.loadChannels([...new Set([...byId.values()].map((v) => v.channel_id))]);

    return {
      // Videos from channels flagged as reuploads or spam would teach the wrong lessons.
      videos: [...byId.values()].filter((v) => channels.has(v.channel_id)).map((v) => ({ ...v, tags: v.tags ?? [], outlier_score: scores.get(v.id) ?? null })),
      channels,
    };
  }
}
