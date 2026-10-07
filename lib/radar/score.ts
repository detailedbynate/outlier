/**
 * One score per radar phrase, from whatever signals have landed so far:
 *
 *   demand  - Google search volume when DataForSEO is on, otherwise how high
 *             the phrase sits in YouTube autocomplete, plus how many views the
 *             ranking videos get;
 *   pay     - CPC when known, otherwise the category's RPM band;
 *   gap     - old results, small channels winning, no giants (supply.ts);
 *   ease    - the AI rating when there is one, otherwise the keyword heuristic.
 *
 * A rising trend adds a little on top, and so does a phrase that only just
 * appeared in autocomplete (new demand that supply hasn't caught up with). A phrase without a supply check isn't
 * scored at all: the gap is the point.
 */

import { easeFor } from "@/lib/niches/discover";
import type { NicheCategory } from "@/lib/niches/labeling";
import { categoryFor, rpmFor } from "@/lib/niches/revenue";
import type { Demand } from "./demand";
import type { EaseRating } from "./ease";
import type { Supply } from "./supply";

export interface RadarSignals {
  keyword: string;
  depth: number;
  suggestRank: number | null;
  category: NicheCategory | null;
  supply: Supply | null;
  demand: Demand | null;
  ease: EaseRating | null;
  /** First seen in a re-sweep of autocomplete: a search that just started. */
  rising?: boolean;
}

export interface RadarScore {
  total: number;
  parts: { demand: number; pay: number; gap: number; ease: number };
  /** RPM band used for pay when CPC wasn't known. */
  rpm: [number, number];
  format: "shorts" | "long_form";
}

const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);

export function scoreRadar(s: RadarSignals): RadarScore | null {
  if (!s.supply || s.supply.results === 0) return null;
  // Autocomplete glue ("roth ira call of duty") and names: nothing relevant ranks, so they'd look wide open.
  if (s.ease?.coherent === false) return null;
  const format = s.supply.shortsShare >= 0.5 ? "shorts" : "long_form";
  const category = s.category ?? categoryFor(s.keyword);
  const rpm = rpmFor(category, format);

  // Demand: real search volume beats autocomplete position, and views on the ranking videos back either up.
  const views = clamp01(Math.log10(s.supply.medianViews + 1) / 6);
  let demand: number;
  if (s.demand?.volume !== null && s.demand?.volume !== undefined) {
    demand = 0.6 * clamp01(Math.log10(s.demand.volume + 1) / 5) + 0.4 * views;
  } else {
    const rank = s.suggestRank === null ? 0.4 : clamp01(1 - s.suggestRank / 10);
    const depth = s.depth <= 1 ? 1 : 0.7;
    demand = 0.4 * rank * depth + 0.6 * views;
  }
  if (s.demand?.trend !== null && s.demand?.trend !== undefined) demand = clamp01(demand + clamp01(s.demand.trend) * 0.15);

  // Pay: CPC from $0.20 to $15 on a log scale, else the RPM band (long-form $0.8-$20, Shorts per its own scale).
  let pay: number;
  if (s.demand?.cpc) pay = clamp01(Math.log10(s.demand.cpc / 0.2) / Math.log10(15 / 0.2));
  else {
    const mid = (rpm[0] + rpm[1]) / 2;
    pay = format === "shorts" ? clamp01(Math.log10(mid / 0.015) / Math.log10(0.25 / 0.015)) : clamp01(Math.log10(mid / 0.8) / Math.log10(20 / 0.8));
  }

  const ease = s.ease ? s.ease.ease / 100 : easeFor(s.keyword, category, format, s.supply.medianMinutes).score;
  let gap = s.supply.gap;
  if (s.rising) {
    demand = clamp01(demand + 0.1);
    gap = clamp01(gap + 0.1);
  }

  const parts = { demand: Math.round(demand * 100), pay: Math.round(pay * 100), gap: Math.round(gap * 100), ease: Math.round(ease * 100) };
  const total = Math.round(0.25 * parts.demand + 0.25 * parts.pay + 0.3 * parts.gap + 0.2 * parts.ease);
  return { total, parts, rpm, format };
}
