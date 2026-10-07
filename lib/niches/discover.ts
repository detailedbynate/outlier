/**
 * Discover: niches ranked without a search. Every term the underrated miner
 * finds is scored on four things a creator actually cares about - what a view
 * pays, how many views there are, how untapped it is, and how easy the videos
 * are to make - separately for Shorts and long-form, since a niche can be open
 * in one format and saturated in the other.
 */

import type { NicheCategory } from "./labeling";
import type { NicheChannel, NicheVideo } from "./analysis";
import { categoryFor, rpmFor } from "./revenue";
import { findUnderratedNiches, type UnderratedNiche } from "./underrated";

export type DiscoverFormat = "shorts" | "long_form";
export type RpmTier = "high" | "mid" | "low";
export type DiscoverSort = "best" | "rpm" | "views" | "untapped" | "easy";

export interface DiscoveredNiche extends UnderratedNiche {
  format: DiscoverFormat;
  category: NicheCategory | null;
  /** Creator RPM range in USD for this format. */
  rpm: [number, number];
  rpmTier: RpmTier;
  /** Rough earnings per 1M views, midpoint of the RPM range. */
  perMillion: number;
  /** Median length of long-form uploads, in minutes, when known. */
  medianMinutes: number | null;
  /** 0-100 each. */
  scores: { rpm: number; views: number; untapped: number; easy: number };
  /** Plain-words reasons it's easy or hard to make. */
  easeNote: string;
  /** Overall 0-100. */
  total: number;
}

const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);

/**
 * How easy a category is to produce, 0-1. Easy means no filming, no travel, no
 * gear, no on-camera skill: voiceover, screen recording, stock footage or AI.
 */
const CATEGORY_EASE: Partial<Record<NicheCategory, number>> = {
  "Education & Explainers": 0.85,
  "Finance & Business": 0.75,
  "Science & Tech": 0.7,
  "Motivation & Self-Improvement": 0.85,
  "News & Commentary": 0.75,
  "Entertainment & Pop Culture": 0.75,
  "Relationships & Social": 0.7,
  Gaming: 0.8,
  "ASMR & Satisfying": 0.6,
  Sports: 0.6,
  "Art & Animation": 0.4,
  "Lifestyle & Vlogs": 0.45,
  "Beauty & Fashion": 0.4,
  "Food & Cooking": 0.35,
  "Fitness & Health": 0.45,
  "DIY, Crafts & Home": 0.3,
  "Cars & Vehicles": 0.3,
  "Animals & Pets": 0.35,
  "Travel & Outdoors": 0.2,
  "Comedy & Skits": 0.35,
  "Music & Dance": 0.25,
  "Kids & Family": 0.4,
};

/** Words that mean a faceless, script-and-voiceover format, or the opposite. */
const EASY_WORDS = /\b(facts?|stories|story|storytime|reddit|explained|explainer|history|mysteries|mystery|true crime|cold cases?|summar(y|ies)|top \d+|ranking|quotes|stoic|psychology|ai|tips|tutorial|news|lore|theory|theories)\b/;
const HARD_WORDS = /\b(vlog|travel|restoration|build|builds|woodworking|cooking|recipe|recipes|workout|training|fishing|hunting|camping|surfing|skateboarding|dance|singing|prank|pranks|challenge|van life|renovation|detailing)\b/;

export function easeFor(term: string, category: NicheCategory | null, format: DiscoverFormat, medianMinutes: number | null): { score: number; note: string } {
  const text = term.toLowerCase();
  let ease = category ? (CATEGORY_EASE[category] ?? 0.5) : 0.5;
  const notes: string[] = [];
  if (EASY_WORDS.test(text)) {
    ease += 0.15;
    notes.push("works faceless with a script and voiceover");
  }
  // "My Singing Monsters" is a game, not a singing channel.
  if (HARD_WORDS.test(text) && category !== "Gaming") {
    ease -= 0.2;
    notes.push("needs filming or hands-on work");
  }
  if (format === "shorts") {
    ease += 0.05;
  } else if (medianMinutes !== null) {
    if (medianMinutes <= 12) {
      ease += 0.1;
      notes.push(`videos run about ${Math.round(medianMinutes)} min`);
    } else if (medianMinutes >= 30) {
      ease -= 0.15;
      notes.push(`videos run long (~${Math.round(medianMinutes)} min)`);
    }
  }
  if (notes.length === 0) notes.push(ease >= 0.6 ? "simple to produce" : ease >= 0.4 ? "moderate effort" : "takes real production work");
  const score = clamp01(ease);
  return { score, note: notes[0]!.charAt(0).toUpperCase() + notes[0]!.slice(1) };
}

/** Long-form RPM bands: $8+ is high, under $3 is low. Shorts: $0.08+ high, under $0.04 low. */
export function rpmTierOf(rpm: [number, number], format: DiscoverFormat): RpmTier {
  const mid = (rpm[0] + rpm[1]) / 2;
  const [high, low] = format === "shorts" ? [0.1, 0.045] : [7, 3];
  return mid >= high ? "high" : mid < low ? "low" : "mid";
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Score one mined niche for a format. */
export function scoreNiche(niche: UnderratedNiche, format: DiscoverFormat, videos: readonly NicheVideo[]): DiscoveredNiche {
  const category = categoryFor(niche.term);
  const rpm = rpmFor(category, format);
  const mid = (rpm[0] + rpm[1]) / 2;
  const minutes = format === "long_form" ? median(videos.flatMap((v) => (v.duration_seconds ? [v.duration_seconds / 60] : []))) : null;
  const ease = easeFor(niche.term, category, format, minutes);

  // RPM on a log scale so $20 isn't 10x better than $2 in the ranking, just clearly better.
  const rpmScore = format === "shorts" ? clamp01(Math.log10(mid / 0.015) / Math.log10(0.25 / 0.015)) : clamp01(Math.log10(mid / 0.8) / Math.log10(20 / 0.8));
  // 1K views a day per upload is good, 30K+ is as good as it gets.
  const viewsScore = clamp01(Math.log10(niche.metrics.medianViewsPerDay / 100 + 1) / Math.log10(300 + 1));
  const untapped = clamp01(0.5 * niche.smallChannelViewShare + 0.25 * (niche.metrics.competition === "low" ? 1 : niche.metrics.competition === "medium" ? 0.5 : 0.1) + 0.25 * clamp01(niche.metrics.viralRate / 0.25));

  const scores = { rpm: Math.round(rpmScore * 100), views: Math.round(viewsScore * 100), untapped: Math.round(untapped * 100), easy: Math.round(ease.score * 100) };
  const total = Math.round(0.3 * scores.rpm + 0.25 * scores.views + 0.3 * scores.untapped + 0.15 * scores.easy);
  return {
    ...niche,
    format,
    category,
    rpm,
    rpmTier: rpmTierOf(rpm, format),
    perMillion: Math.round(mid * 1000),
    medianMinutes: minutes === null ? null : Math.round(minutes),
    scores,
    easeNote: ease.note,
    total,
  };
}

/** Mine one format's slice of the library and score everything that clears the underrated bar. */
export function discoverNiches(
  videos: readonly NicheVideo[],
  channels: ReadonlyMap<string, NicheChannel>,
  format: DiscoverFormat,
  options: { now?: Date; max?: number } = {},
): DiscoveredNiche[] {
  const slice = videos.filter((v) => (format === "shorts" ? v.format === "short" : v.format === "long_form"));
  // Long-form gets fewer views per upload than Shorts; don't hold it to the Shorts bar.
  // Mine wide, then keep only names Outlier knows the category of: that drops title
  // words like "hero" or "david" and gives every niche a real RPM band.
  const mined = findUnderratedNiches(slice, channels, { max: options.max ?? 250, now: options.now, minViewsPerDay: format === "shorts" ? 300 : 100 }).filter(
    (niche) => categoryFor(niche.term) !== null,
  );
  const byTerm = (term: string) => {
    const words = term.toLowerCase();
    return slice.filter((v) => v.title.toLowerCase().includes(words) || v.tags.some((t) => t.toLowerCase() === words));
  };
  // Hashtags like "allinmlbb" mine the same videos as "Mobile Legends": keep the best-named one.
  const kept: { niche: UnderratedNiche; ids: Set<string> }[] = [];
  for (const niche of mined) {
    const ids = new Set(niche.examples.map((e) => e.youtubeVideoId));
    const twin = kept.find((k) => sameNiche(k.niche, niche, k.ids, ids));
    if (!twin) kept.push({ niche, ids });
  }
  return kept.map(({ niche }) => scoreNiche(niche, format, byTerm(niche.term)));
}

/** Two mined terms describing the same set of videos. */
function sameNiche(a: UnderratedNiche, b: UnderratedNiche, aIds: Set<string>, bIds: Set<string>): boolean {
  const m = a.metrics;
  const n = b.metrics;
  if (m.videos === n.videos && m.channels === n.channels && Math.round(m.medianViewsPerDay) === Math.round(n.medianViewsPerDay)) return true;
  if (aIds.size < 2 || bIds.size < 2) return false;
  const shared = [...aIds].filter((id) => bIds.has(id)).length;
  return shared / Math.min(aIds.size, bIds.size) >= 0.6;
}

export function sortDiscovered(niches: readonly DiscoveredNiche[], sort: DiscoverSort): DiscoveredNiche[] {
  const key: Record<DiscoverSort, (n: DiscoveredNiche) => number> = {
    best: (n) => n.total,
    rpm: (n) => n.scores.rpm * 10 + n.total / 100,
    views: (n) => n.scores.views * 10 + n.total / 100,
    untapped: (n) => n.scores.untapped * 10 + n.total / 100,
    easy: (n) => n.scores.easy * 10 + n.total / 100,
  };
  return [...niches].sort((a, b) => key[sort](b) - key[sort](a));
}
