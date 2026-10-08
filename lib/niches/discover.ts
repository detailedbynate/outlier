/**
 * Discover: niches ranked without a search. Every term the underrated miner
 * finds is scored on what a creator actually cares about - what a view pays,
 * how many views an upload gets, how big the whole audience is, how untapped it
 * is, and how easy it is to start - separately for Shorts and long-form, since a
 * niche can be open in one format and saturated in the other.
 */

import { NICHE_CATEGORIES, type NicheCategory } from "./labeling";
import { topicAliases, type NicheChannel, type NicheVideo } from "./analysis";
import { normalizeName } from "./naming";
import { adjustRpm, audienceAdjustment, categoryFor, rpmFor } from "./revenue";
import { findUnderratedNiches, type UnderratedNiche } from "./underrated";

export type DiscoverFormat = "shorts" | "long_form";
export type RpmTier = "high" | "mid" | "low";
export type DiscoverSort = "bets" | "best" | "rpm" | "views" | "audience" | "untapped" | "easy";

const DAY = 86_400_000;
/** A channel this young counts as new. */
const NEW_CHANNEL_DAYS = 365;
/** Views one upload needs for a new channel to count as having made it here. */
export const NEWCOMER_BAR: Record<DiscoverFormat, number> = { shorts: 10_000, long_form: 5_000 };
/** Uploads younger than this haven't had their views yet, so they can't count against a channel. */
const SETTLE_DAYS = 3;
/** Fewer new channels than this and their record says too little to go on. */
const MIN_NEWCOMERS = 3;

/** How channels under a year old are doing in a niche: the real test of "easy to start". */
export interface Newcomers {
  /** New channels posting here with at least one upload old enough to judge. */
  channels: number;
  /** How many of them have an upload past NEWCOMER_BAR. */
  hits: number;
  bar: number;
  /** Views on a typical new channel's best upload here. */
  medianBest: number | null;
  /** The best upload from a new channel, as proof. */
  best: { youtubeVideoId: string; title: string; channelTitle: string; views: number; channelMonths: number } | null;
}

export interface DiscoveredNiche extends UnderratedNiche {
  format: DiscoverFormat;
  category: NicheCategory | null;
  /** Creator RPM range in USD for this format: the category's band, moved for this niche's audience. */
  rpm: [number, number];
  /** What moved it off the category's band, when something did. */
  rpmNote: string | null;
  rpmTier: RpmTier;
  /** Rough earnings per 1M views, midpoint of the RPM range. */
  perMillion: number;
  /** Median length of long-form uploads, in minutes, when known. */
  medianMinutes: number | null;
  /**
   * Views a month the niche's recent uploads pull across the tracked library,
   * estimated from the sample. Undercounts YouTube as a whole, but ranks fairly.
   */
  monthlyViews: number;
  newcomers: Newcomers;
  /** 0-100 each. Easy blends how new channels actually do with how much work the videos take. */
  scores: { rpm: number; views: number; audience: number; untapped: number; easy: number };
  /** Plain-words reasons it's easy or hard to make. */
  easeNote: string;
  /** How new channels have done here, in one line; null with too few to tell. */
  startNote: string | null;
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

/**
 * How channels under a year old have done with their uploads in a niche. Any
 * niche looks easy from the outside; this is whether people starting now are
 * actually getting views.
 */
export function newcomersIn(videos: readonly NicheVideo[], channels: ReadonlyMap<string, NicheChannel>, format: DiscoverFormat, now: Date): Newcomers {
  const bar = NEWCOMER_BAR[format];
  const best = new Map<string, NicheVideo>();
  for (const video of videos) {
    const created = channels.get(video.channel_id)?.published_at;
    if (!created || now.getTime() - Date.parse(created) > NEW_CHANNEL_DAYS * DAY) continue;
    if (now.getTime() - Date.parse(video.published_at) < SETTLE_DAYS * DAY) continue;
    const top = best.get(video.channel_id);
    if (!top || video.view_count > top.view_count) best.set(video.channel_id, video);
  }
  const tops = [...best.values()];
  const winner = tops.sort((a, b) => b.view_count - a.view_count)[0];
  const channel = winner ? channels.get(winner.channel_id) : undefined;
  return {
    channels: tops.length,
    hits: tops.filter((v) => v.view_count >= bar).length,
    bar,
    medianBest: tops.length ? Math.round(median(tops.map((v) => v.view_count))!) : null,
    best:
      winner && channel
        ? {
            youtubeVideoId: winner.youtube_video_id,
            title: winner.title,
            channelTitle: channel.title,
            views: winner.view_count,
            channelMonths: Math.max(1, Math.round((now.getTime() - Date.parse(channel.published_at!)) / (30 * DAY))),
          }
        : null,
  };
}

/**
 * Views a month flowing to a niche's recent uploads: each upload's views per day
 * so far, times 30, times how many library uploads it stands for in the sample.
 * A day-old upload's pace isn't its real one, so the clock starts at a week.
 */
export function monthlyViewsOf(videos: readonly NicheVideo[], now: Date, weightOf: (publishedAt: string) => number = () => 1): number {
  let perDay = 0;
  for (const video of videos) {
    const days = Math.max((now.getTime() - Date.parse(video.published_at)) / DAY, 7);
    perDay += (video.view_count / days) * weightOf(video.published_at);
  }
  return Math.round(perDay * 30);
}

const formatBar = (n: number) => (n >= 1_000 ? `${Math.round(n / 1_000)}K` : String(n));

/** Score one mined niche for a format. */
export function scoreNiche(
  niche: UnderratedNiche,
  format: DiscoverFormat,
  videos: readonly NicheVideo[],
  context: { channels?: ReadonlyMap<string, NicheChannel>; now?: Date; weightOf?: (publishedAt: string) => number; category?: NicheCategory | null } = {},
): DiscoveredNiche {
  const now = context.now ?? new Date();
  const category = context.category ?? categoryFor(niche.term);
  const audience = audienceAdjustment(
    videos.map((v) => ({
      channelId: v.channel_id,
      country: context.channels?.get(v.channel_id)?.country ?? null,
      madeForKids: v.made_for_kids === true,
      minutes: v.duration_seconds ? v.duration_seconds / 60 : null,
      views: v.view_count,
    })),
    format,
  );
  const rpm = adjustRpm(rpmFor(category, format, niche.term), audience.factor, format);
  const mid = (rpm[0] + rpm[1]) / 2;
  const minutes = format === "long_form" ? median(videos.flatMap((v) => (v.duration_seconds ? [v.duration_seconds / 60] : []))) : null;
  const ease = easeFor(niche.term, category, format, minutes);
  const newcomers = newcomersIn(videos, context.channels ?? new Map(), format, now);
  const monthlyViews = monthlyViewsOf(videos, now, context.weightOf);

  // RPM on a log scale so $20 isn't 10x better than $2 in the ranking, just clearly better.
  const rpmScore = format === "shorts" ? clamp01(Math.log10(mid / 0.015) / Math.log10(0.25 / 0.015)) : clamp01(Math.log10(mid / 0.8) / Math.log10(20 / 0.8));
  // 1K views a day per upload is good, 30K+ is as good as it gets.
  const viewsScore = clamp01(Math.log10(niche.metrics.medianViewsPerDay / 100 + 1) / Math.log10(300 + 1));
  // Shorts: 1M views a month is a sliver, 1B is as big as it gets. Long-form runs 10x smaller.
  const floor = format === "shorts" ? 1_000_000 : 100_000;
  const audienceScore = clamp01(Math.log10(Math.max(monthlyViews, 1) / floor) / 3);
  const untapped = clamp01(0.5 * niche.smallChannelViewShare + 0.25 * (niche.metrics.competition === "low" ? 1 : niche.metrics.competition === "medium" ? 0.5 : 0.1) + 0.25 * clamp01(niche.metrics.viralRate / 0.25));
  // What new channels actually got beats any guess about the work involved, once there are enough of them.
  // Half from how many got past the bar, half from how far: a typical first hit of 10x the bar is as good as it gets.
  const proven =
    newcomers.channels >= MIN_NEWCOMERS
      ? 0.5 * (newcomers.hits / newcomers.channels) + 0.5 * clamp01(Math.log10(Math.max(newcomers.medianBest ?? 0, 1) / (newcomers.bar / 10)) / 2)
      : null;
  const easy = proven === null ? ease.score : 0.6 * proven + 0.4 * ease.score;

  const scores = {
    rpm: Math.round(rpmScore * 100),
    views: Math.round(viewsScore * 100),
    audience: Math.round(audienceScore * 100),
    untapped: Math.round(untapped * 100),
    easy: Math.round(easy * 100),
  };
  const total = Math.round(0.25 * scores.rpm + 0.15 * scores.views + 0.15 * scores.audience + 0.25 * scores.untapped + 0.2 * scores.easy);
  return {
    ...niche,
    format,
    category,
    rpm,
    rpmNote: audience.note,
    rpmTier: rpmTierOf(rpm, format),
    perMillion: Math.round(mid * 1000),
    medianMinutes: minutes === null ? null : Math.round(minutes),
    monthlyViews,
    newcomers,
    scores,
    easeNote: ease.note,
    startNote: proven === null ? null : `${newcomers.hits} of ${newcomers.channels} channels started this year got a ${formatBar(newcomers.bar)}+ video`,
    total,
  };
}

/**
 * How many library uploads each sampled one stands for, by when it went up.
 * The sample takes an even share of every stretch of the window while the
 * library grew, so an early upload can stand for fewer than a recent one.
 */
export function libraryWeights(videos: readonly Pick<NicheVideo, "published_at">[], slices: readonly { from: Date; to: Date; count: number }[]): (publishedAt: string) => number {
  const sampled = slices.map(() => 0);
  const sliceOf = (publishedAt: string) => {
    const at = Date.parse(publishedAt);
    return slices.findIndex((s) => at >= s.from.getTime() && at < s.to.getTime());
  };
  for (const video of videos) {
    const i = sliceOf(video.published_at);
    if (i >= 0) sampled[i]! += 1;
  }
  const weights = slices.map((s, i) => (sampled[i]! > 0 ? Math.max(s.count / sampled[i]!, 1) : 1));
  return (publishedAt) => {
    const i = sliceOf(publishedAt);
    return i >= 0 ? weights[i]! : 1;
  };
}

/** Mine one format's slice of the library and score everything that clears the underrated bar. */
export function discoverNiches(
  videos: readonly NicheVideo[],
  channels: ReadonlyMap<string, NicheChannel>,
  format: DiscoverFormat,
  options: { now?: Date; max?: number; weightOf?: (publishedAt: string) => number } = {},
): DiscoveredNiche[] {
  const now = options.now ?? new Date();
  const slice = videos.filter(
    (v) => (format === "shorts" ? v.format === "short" : v.format === "long_form") && !SPAM.test(v.title) && !SPAM.test(channels.get(v.channel_id)?.title ?? ""),
  );
  // Long-form gets fewer views per upload than Shorts; don't hold it to the Shorts bar.
  // Mine wide, then keep only names with a known category: that drops title words
  // like "hero" or "david" and gives every niche a real RPM band.
  const categories = new Map<string, NicheCategory>();
  const mined = findUnderratedNiches(slice, channels, { max: options.max ?? 250, now, minViewsPerDay: format === "shorts" ? 300 : 100 }).filter((niche) => {
    const category = categoryFor(niche.term) ?? channelCategory(niche, slice, channels);
    if (category) categories.set(niche.term, category);
    return category !== null;
  });
  // Titles and tags normalized once: every niche is matched against all of them.
  const texts = slice.map((v) => {
    const spaced = ` ${normalizeName([v.title, ...v.tags.slice(0, 30)].join(" "))} `;
    return { spaced, squashed: spaced.replace(/ /g, "") };
  });
  // A niche's uploads are the ones naming it or one of its aliases: "msm" is My Singing Monsters too.
  const byTerm = (term: string) => {
    const phrases = [...new Set([term, ...topicAliases(term)].map(normalizeName).filter((p) => p.length >= 2))];
    const squashed = phrases.map((p) => p.replace(/ /g, "")).filter((p) => p.length >= 5);
    return slice.filter((_, i) => phrases.some((p) => texts[i]!.spaced.includes(` ${p} `)) || squashed.some((p) => texts[i]!.squashed.includes(p)));
  };
  // Hashtags like "allinmlbb" mine the same videos as "Mobile Legends": keep the best-named one,
  // which is a name the dictionary knows over one that only borrowed its channels' subject.
  const known = (n: UnderratedNiche) => categoryFor(n.term) !== null;
  const ranked = [...mined].sort((a, b) => Number(known(b)) - Number(known(a)));
  const kept: { niche: UnderratedNiche; ids: Set<string>; videos: NicheVideo[]; videoIds: Set<string> }[] = [];
  for (const niche of ranked) {
    const ids = new Set(niche.examples.map((e) => e.youtubeVideoId));
    const videos = byTerm(niche.term);
    if (!known(niche) && !looksLikeNiche(niche.term, videos, channels)) continue;
    const videoIds = new Set(videos.map((v) => v.id));
    const twin = kept.find((k) => sameNiche(k.niche, niche, k.ids, ids) || mostlyShared(k.videoIds, videoIds));
    if (!twin) kept.push({ niche, ids, videos, videoIds });
  }
  // Back in the miner's order.
  kept.sort((a, b) => mined.indexOf(a.niche) - mined.indexOf(b.niche));
  return kept.map(({ niche, videos }) => scoreNiche(niche, format, videos, { channels, now, weightOf: options.weightOf, category: categories.get(niche.term) }));
}

/** Adult and bait spam that slips in under ordinary words ("japan movie"). */
const SPAM = /\b(s[e3]x|sexy|nsfw|erotic|onlyfans|nude|kissing massage|oil massage|hot massage)\b/i;

/** Channels that have to say a name in their titles, not just hashtag it, before it's a niche. */
const MIN_TITLE_CHANNELS = 3;
/** Different creators a niche needs: one person under four channel names is still one. */
const MIN_CREATORS = 4;

/**
 * A mined name the dictionary doesn't know is only a niche if it reads like one:
 * not hashtags run together ("mlbb10th allinmlbb"), not a creator's own name
 * ("hummus thunder"), and not one creator posting under a few channel names.
 */
export function looksLikeNiche(term: string, videos: readonly NicheVideo[], channels: ReadonlyMap<string, NicheChannel>): boolean {
  if (term.split(/\s+/).some((word) => word.length >= 6 && /[a-z]\d|\d[a-z]{3,}/i.test(word))) return false;
  const key = normalizeName(term);
  if (!key) return false;
  const inTitles = new Set(videos.filter((v) => ` ${normalizeName(v.title.replace(/#\S+/g, " "))} `.includes(` ${key} `)).map((v) => v.channel_id));
  if (inTitles.size < MIN_TITLE_CHANNELS) return false;
  const squashed = key.replace(/ /g, "");
  const squash = (title: string) => normalizeName(title).replace(/ /g, "");
  const named = videos.filter((v) => squashed.length >= 5 && squash(channels.get(v.channel_id)?.title ?? "").includes(squashed)).length;
  if (named >= 0.3 * videos.length) return false;
  const creators = new Set([...new Set(videos.map((v) => v.channel_id))].map((id) => creatorKey(channels.get(id)?.title ?? id)));
  return creators.size >= MIN_CREATORS;
}

/** "SnappiyTV", "Snapiyy TV" and "Snappiy" are one creator: compare channel names by their consonants. */
function creatorKey(title: string): string {
  const squashed = normalizeName(title)
    .replace(/ /g, "")
    .replace(/(tv|yt|gaming|official|shorts|clips|live)+$/, "");
  return (squashed.replace(/[aeiouy]/g, "").replace(/(.)\1+/g, "$1").slice(0, 6) || squashed).slice(0, 8);
}

/** Most of the smaller set's uploads are in the bigger one: the same niche under two names. */
function mostlyShared(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  if (small.size < 3) return false;
  let shared = 0;
  for (const id of small) if (big.has(id)) shared += 1;
  // Hashtag twins share nearly everything; Elden Ring and Dark Souls share a lot and are still two niches.
  return shared / small.size >= 0.85;
}

/** Labeled channels a niche needs before their subject can stand in for its own. */
const MIN_LABELED_CHANNELS = 3;

/**
 * A niche the dictionary doesn't know ("Arc Raiders", "Comic Dub") takes the
 * subject of the channels making it, when most of them agree. Only names: a
 * lone word like "dragon" or "broken" could be anything, so it needs to be a
 * channel's own label, or more than one word.
 */
function channelCategory(niche: UnderratedNiche, videos: readonly NicheVideo[], channels: ReadonlyMap<string, NicheChannel>): NicheCategory | null {
  const key = normalizeName(niche.term);
  const ids = new Set(videos.filter((v) => normalizeName(v.title).includes(key) || v.tags.some((t) => normalizeName(t) === key)).map((v) => v.channel_id));
  const labeledHere = [...ids].flatMap((id) => channels.get(id)?.niche_terms ?? []).some((t) => normalizeName(t) === key);
  if (!key.includes(" ") && !labeledHere) return null;
  const counts = new Map<string, number>();
  let labeled = 0;
  for (const id of ids) {
    const category = channels.get(id)?.category;
    if (!category || category === "Other") continue;
    labeled += 1;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  if (labeled < MIN_LABELED_CHANNELS) return null;
  const [top, count] = [...counts].sort((a, b) => b[1] - a[1])[0]!;
  return count / labeled >= 0.6 && (NICHE_CATEGORIES as readonly string[]).includes(top) ? (top as NicheCategory) : null;
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

/** What a best bet has to be good at. Pay only breaks ties: in gaming it's who watches, not the niche. */
const BET_PARTS = ["easy", "audience", "views", "untapped"] as const;

/** 0-1 for each niche: where it stands in this list, 1 = top. Ties share a rank. */
function percentiles(niches: readonly DiscoveredNiche[], value: (n: DiscoveredNiche) => number): Map<DiscoveredNiche, number> {
  const values = niches.map(value).sort((a, b) => a - b);
  const out = new Map<DiscoveredNiche, number>();
  for (const n of niches) {
    const v = value(n);
    const below = values.filter((x) => x < v).length;
    const equal = values.filter((x) => x === v).length;
    out.set(n, niches.length > 1 ? (below + (equal - 1) / 2) / (niches.length - 1) : 1);
  }
  return out;
}

/**
 * Each niche's weakest showing among the things a best bet needs, measured
 * against the rest of this list: 0.5 means it's in the top half on every one.
 * Relative, so it works inside gaming, where every niche pays about the same,
 * as well as across all niches.
 */
export function allRoundScores(niches: readonly DiscoveredNiche[]): Map<DiscoveredNiche, { weakest: number; pay: number }> {
  const ranks = BET_PARTS.map((part) => percentiles(niches, (n) => n.scores[part]));
  const pay = percentiles(niches, (n) => n.scores.rpm);
  return new Map(niches.map((n) => [n, { weakest: Math.min(...ranks.map((r) => r.get(n)!)), pay: pay.get(n)! }]));
}

export function sortDiscovered(niches: readonly DiscoveredNiche[], sort: DiscoverSort): DiscoveredNiche[] {
  const round = sort === "bets" ? allRoundScores(niches) : null;
  const key: Record<DiscoverSort, (n: DiscoveredNiche) => number> = {
    bets: (n) => {
      const r = round!.get(n)!;
      return 0.8 * r.weakest + 0.2 * r.pay + n.total / 10_000;
    },
    best: (n) => n.total,
    rpm: (n) => n.scores.rpm * 10 + n.total / 100,
    views: (n) => n.scores.views * 10 + n.total / 100,
    audience: (n) => n.scores.audience * 10 + n.total / 100,
    untapped: (n) => n.scores.untapped * 10 + n.total / 100,
    easy: (n) => n.scores.easy * 10 + n.total / 100,
  };
  return [...niches].sort((a, b) => key[sort](b) - key[sort](a));
}
