import type { RadarDeps } from "@/lib/services/niche-radar-service";
import type { NicheIdeaRow, NicheKeywordRow, TablesInsert } from "@/types/database";

/** An in-memory stand-in for RadarRepository, close enough to its ordering rules for tests. */
export function memoryRadar(): RadarDeps["radar"] & { rows: Map<string, NicheKeywordRow>; ideaRows: NicheIdeaRow[] } {
  const rows = new Map<string, NicheKeywordRow>();
  const ideaRows: NicheIdeaRow[] = [];
  const all = () => [...rows.values()];
  const byScore = (a: NicheKeywordRow, b: NicheKeywordRow) => (b.score ?? -1) - (a.score ?? -1);
  return {
    rows,
    ideaRows,
    countKeywords: async () => rows.size,
    addKeywords: async (insert: TablesInsert<"niche_keywords">[]) => {
      let added = 0;
      for (const r of insert) {
        if (rows.has(r.keyword)) continue;
        rows.set(r.keyword, {
          source: "autocomplete", depth: 0, suggest_rank: null, category: null, discovered_at: new Date().toISOString(), expanded_at: null,
          supply_checked_at: null, supply: null, demand_checked_at: null, demand: null, ease_checked_at: null, ease: null, score: null, priority: 0,
          updated_at: new Date().toISOString(), ...r,
        } as NicheKeywordRow);
        added += 1;
      }
      return added;
    },
    dueForExpansion: async (maxDepth, limit) =>
      all()
        .filter((r) => !r.expanded_at && r.depth <= maxDepth && (r.depth === 0 || r.source === "reddit" || r.source === "rising" || (r.suggest_rank ?? 99) <= 2))
        .sort((a, b) => a.depth - b.depth)
        .slice(0, limit),
    dueForResweep: async (before, limit) =>
      all()
        .filter((r) => r.depth === 0 && r.expanded_at && new Date(r.expanded_at) < before)
        .sort((a, b) => a.expanded_at!.localeCompare(b.expanded_at!))
        .slice(0, limit),
    dueForSupply: async (staleBefore, limit) =>
      all()
        .filter((r) => !r.supply_checked_at || new Date(r.supply_checked_at) < staleBefore)
        .sort((a, b) => Number(!b.supply_checked_at) - Number(!a.supply_checked_at) || (b.priority ?? 0) - (a.priority ?? 0))
        .slice(0, limit),
    dueForDemand: async (staleBefore, limit) =>
      all().filter((r) => r.supply_checked_at && (!r.demand_checked_at || new Date(r.demand_checked_at) < staleBefore)).sort(byScore).slice(0, limit),
    dueForEase: async (limit, minScore = 0) => all().filter((r) => r.supply_checked_at && !r.ease_checked_at && (r.score ?? -1) >= minScore).sort(byScore).slice(0, limit),
    update: async (keyword, patch) => {
      const row = rows.get(keyword);
      if (row) rows.set(keyword, { ...row, ...patch });
    },
    markExpanded: async (keywords, at) => {
      for (const k of keywords) {
        const row = rows.get(k);
        if (row) row.expanded_at = at.toISOString();
      }
    },
    top: async ({ limit, minScore, category }) =>
      all().filter((r) => r.score !== null && (minScore === undefined || r.score >= minScore) && (!category || r.category === category)).sort(byScore).slice(0, limit),
    get: async (keyword) => rows.get(keyword) ?? null,
    addIdeas: async (insert) => {
      for (const r of insert) ideaRows.push({ id: String(ideaRows.length), community: null, score: 0, comments: 0, views: null, posted_at: null, kind: "discussion", category: null, collected_at: new Date().toISOString(), ...r } as NicheIdeaRow);
      return insert.length;
    },
    ideas: async ({ limit, source, orderBy }) =>
      ideaRows
        .filter((r) => !source || r.source === source)
        .sort((a, b) => (orderBy === "views" ? (b.views ?? -1) - (a.views ?? -1) : b.score - a.score))
        .slice(0, limit),
    lastIdeasAt: async (source) => {
      const mine = ideaRows.filter((r) => !source || r.source === source);
      return mine.length ? new Date(mine[mine.length - 1]!.collected_at) : null;
    },
  };
}
