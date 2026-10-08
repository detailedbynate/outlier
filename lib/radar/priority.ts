/**
 * Which unchecked phrases to read first. Expansion finds thousands of phrases a
 * day and a supply check costs a scraped search, so the queue has to put the
 * likely winners up front: new searches, phrases in categories that pay, and
 * phrases near the top of autocomplete (searched more).
 */

import type { NicheCategory } from "@/lib/niches/labeling";
import { categoryFor, rpmFor } from "@/lib/niches/revenue";

export interface PriorityInput {
  keyword: string;
  category: NicheCategory | string | null;
  source: string;
  depth: number;
  suggestRank: number | null;
  /** Monthly Google searches when looked up; 0 when Google had none, null before asking. */
  volume?: number | null;
}

const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);

/** 0-100. */
export function priorityOf(input: PriorityInput): number {
  const category = (input.category as NicheCategory | null) ?? categoryFor(input.keyword);
  const [low, high] = rpmFor(category, "long_form");
  // Long-form RPM from $0.8 to $20 on a log scale: finance and tech near 1. Gaming is
  // what most users come for, so it isn't pushed to the back for paying little.
  const pay = category === "Gaming" ? 0.8 : clamp01(Math.log10((low + high) / 2 / 0.8) / Math.log10(20 / 0.8));
  const rank = input.suggestRank === null ? 0.5 : clamp01(1 - input.suggestRank / 10);
  const shallow = input.depth <= 1 ? 1 : 0.6;
  // New searches, and games that just started climbing the charts.
  const fresh = input.source === "rising" || input.source === "game" ? 1 : 0;
  if (input.volume === null || input.volume === undefined) return Math.round(100 * (0.45 * pay + 0.25 * rank * shallow + 0.3 * fresh));
  // Real searches beat autocomplete's guess: 100K a month is as good as it gets, none sends it to the back.
  const searched = clamp01(Math.log10(input.volume + 1) / 5);
  return Math.round(100 * (input.volume === 0 ? 0.2 * pay : 0.3 * pay + 0.45 * searched + 0.1 * rank * shallow + 0.15 * fresh));
}
