import "server-only";
import type { DatabaseClient } from "@/lib/database/client";
import { assertOk, unwrap } from "@/lib/database/errors";
import type { NicheIdeaRow, NicheKeywordRow, TablesInsert } from "@/types/database";

/** Search phrases the Niche Radar tracks, and the Reddit posts it collects as ideas. */
export class RadarRepository {
  constructor(private readonly db: DatabaseClient) {}

  async countKeywords(): Promise<number> {
    const { count, error } = await this.db.from("niche_keywords").select("keyword", { count: "exact", head: true });
    if (error) throw error;
    return count ?? 0;
  }

  /** New phrases only: a phrase already known keeps its seed, depth and signals. */
  async addKeywords(rows: TablesInsert<"niche_keywords">[]): Promise<number> {
    if (rows.length === 0) return 0;
    let added = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const inserted = unwrap(
        await this.db.from("niche_keywords").upsert(rows.slice(i, i + 500), { onConflict: "keyword", ignoreDuplicates: true }).select("keyword"),
        "niche_keywords.add",
      );
      added += inserted.length;
    }
    return added;
  }

  /** Phrases to grow next: shallow before deep, never-expanded first. */
  async dueForExpansion(maxDepth: number, limit: number): Promise<NicheKeywordRow[]> {
    return unwrap(
      await this.db
        .from("niche_keywords")
        .select("*")
        .is("expanded_at", null)
        .lte("depth", maxDepth)
        // Seeds always grow; deeper phrases only when they sit near the top of autocomplete,
        // or the tree multiplies into millions of long-tail phrases nobody searches.
        .or("depth.eq.0,source.in.(reddit,rising),suggest_rank.lte.2")
        .order("depth", { ascending: true })
        .order("priority", { ascending: false })
        .order("suggest_rank", { ascending: true, nullsFirst: true })
        .limit(limit),
      "niche_keywords.dueForExpansion",
    );
  }

  /** Seeds whose autocomplete was last swept before `before`: sweeping again is how new searches show up. */
  async dueForResweep(before: Date, limit: number): Promise<NicheKeywordRow[]> {
    return unwrap(
      await this.db
        .from("niche_keywords")
        .select("*")
        .eq("depth", 0)
        .lt("expanded_at", before.toISOString())
        .order("expanded_at", { ascending: true })
        .limit(limit),
      "niche_keywords.dueForResweep",
    );
  }

  /** Phrases whose search results to read next: never-checked first, most promising (priority.ts) first, then the stalest. */
  async dueForSupply(staleBefore: Date, limit: number): Promise<NicheKeywordRow[]> {
    return unwrap(
      await this.db
        .from("niche_keywords")
        .select("*")
        .or(`supply_checked_at.is.null,supply_checked_at.lt.${staleBefore.toISOString()}`)
        .order("supply_checked_at", { ascending: true, nullsFirst: true })
        .order("priority", { ascending: false })
        .limit(limit),
      "niche_keywords.dueForSupply",
    );
  }

  async dueForDemand(staleBefore: Date, limit: number): Promise<NicheKeywordRow[]> {
    return unwrap(
      await this.db
        .from("niche_keywords")
        .select("*")
        .not("supply_checked_at", "is", null)
        .or(`demand_checked_at.is.null,demand_checked_at.lt.${staleBefore.toISOString()}`)
        .order("score", { ascending: false, nullsFirst: false })
        .limit(limit),
      "niche_keywords.dueForDemand",
    );
  }

  /**
   * Checked phrases with no AI ease rating yet, best first so the top of the list
   * gets rated soonest. Below minScore a phrase never reaches a board, so it isn't
   * worth a model call.
   */
  async dueForEase(limit: number, minScore = 0): Promise<NicheKeywordRow[]> {
    return unwrap(
      await this.db
        .from("niche_keywords")
        .select("*")
        .not("supply_checked_at", "is", null)
        .is("ease_checked_at", null)
        .gte("score", minScore)
        .order("score", { ascending: false, nullsFirst: false })
        .limit(limit),
      "niche_keywords.dueForEase",
    );
  }

  async update(keyword: string, patch: Partial<NicheKeywordRow>): Promise<void> {
    assertOk(await this.db.from("niche_keywords").update({ ...patch, updated_at: new Date().toISOString() }).eq("keyword", keyword), "niche_keywords.update");
  }

  async markExpanded(keywords: string[], at: Date): Promise<void> {
    if (keywords.length === 0) return;
    assertOk(await this.db.from("niche_keywords").update({ expanded_at: at.toISOString() }).in("keyword", keywords), "niche_keywords.markExpanded");
  }

  async top(options: { limit: number; minScore?: number; category?: string | null; market?: string }): Promise<NicheKeywordRow[]> {
    let query = this.db.from("niche_keywords").select("*").not("score", "is", null);
    if (options.minScore !== undefined) query = query.gte("score", options.minScore);
    if (options.market) query = query.eq("market", options.market);
    if (options.category) query = query.eq("category", options.category);
    return unwrap(await query.order("score", { ascending: false }).limit(options.limit), "niche_keywords.top");
  }

  /** Which of these phrases have already been seeds for a source (e.g. already translated). */
  async seededFrom(source: string, seeds: readonly string[]): Promise<Set<string>> {
    if (seeds.length === 0) return new Set();
    const rows = unwrap(await this.db.from("niche_keywords").select("seed").eq("source", source).in("seed", [...seeds]), "niche_keywords.seededFrom");
    return new Set(rows.map((r) => r.seed));
  }

  async lastAddedAt(source: string): Promise<Date | null> {
    const rows = unwrap(
      await this.db.from("niche_keywords").select("discovered_at").eq("source", source).order("discovered_at", { ascending: false }).limit(1),
      "niche_keywords.lastAdded",
    );
    return rows[0] ? new Date(rows[0].discovered_at) : null;
  }

  async get(keyword: string): Promise<NicheKeywordRow | null> {
    const rows = unwrap(await this.db.from("niche_keywords").select("*").eq("keyword", keyword).limit(1), "niche_keywords.get");
    return rows[0] ?? null;
  }

  async addIdeas(rows: TablesInsert<"niche_ideas">[]): Promise<number> {
    if (rows.length === 0) return 0;
    // A post seen again refreshes its score and comment count.
    const saved = unwrap(await this.db.from("niche_ideas").upsert(rows, { onConflict: "url" }).select("id"), "niche_ideas.add");
    return saved.length;
  }

  async ideas(options: { limit: number; since: Date; kind?: string; source?: string; category?: string | null; orderBy?: "score" | "views" }): Promise<NicheIdeaRow[]> {
    let query = this.db.from("niche_ideas").select("*").gte("collected_at", options.since.toISOString());
    if (options.kind) query = query.eq("kind", options.kind);
    if (options.source) query = query.eq("source", options.source);
    if (options.category) query = query.eq("category", options.category);
    return unwrap(await query.order(options.orderBy ?? "score", { ascending: false, nullsFirst: false }).limit(options.limit), "niche_ideas.list");
  }

  async lastIdeasAt(source?: string): Promise<Date | null> {
    let query = this.db.from("niche_ideas").select("collected_at");
    if (source) query = query.eq("source", source);
    const rows = unwrap(await query.order("collected_at", { ascending: false }).limit(1), "niche_ideas.last");
    return rows[0] ? new Date(rows[0].collected_at) : null;
  }
}

