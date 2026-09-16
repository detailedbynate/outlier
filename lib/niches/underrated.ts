/**
 * Underrated niches: terms that appear across the stored library where small
 * channels are pulling real views and no one has locked the space down. This is
 * the point of the tool - not the niches everyone already names.
 */

import { computeNicheMetrics, tokenize, type NicheChannel, type NicheMetrics, type NicheVideo } from "./analysis";

const DAY = 86_400_000;
const SMALL_CHANNEL_SUBS = 100_000;

export interface UnderratedNiche {
  term: string;
  metrics: NicheMetrics;
  /** 0-100: demand a small channel can actually reach. */
  score: number;
  /** Share of this niche's views going to channels under 100K subscribers. */
  smallChannelViewShare: number;
  reason: string;
}

export interface UnderratedOptions {
  max?: number;
  /** A niche needs this many videos and channels before it's worth showing. */
  minVideos?: number;
  minChannels?: number;
  /** 0 = views spread evenly, 1 = one channel takes everything. Above this, the space is locked down. */
  maxDominance?: number;
  /** A term in more than this share of the library is a category, not a niche. */
  maxLibraryShare?: number;
  /** How many channels must be built around the term rather than mentioning it once. */
  minFocusedChannels?: number;
  /** Median views per day a niche must reach to count as alive. */
  minViewsPerDay?: number;
  now?: Date;
}

const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);

/** Share of a channel's uploads that must carry the term for the channel to count as "about" it. */
const FOCUS_SHARE = 0.25;

function terms(video: Pick<NicheVideo, "title" | "tags">): Set<string> {
  const found = new Set<string>();
  const words = tokenize(video.title);
  for (let i = 0; i < words.length; i++) {
    found.add(words[i]!);
    if (i + 1 < words.length) found.add(`${words[i]} ${words[i + 1]}`);
  }
  for (const tag of video.tags.slice(0, 30)) {
    const tagWords = tokenize(tag);
    if (tagWords.length === 1 || tagWords.length === 2) found.add(tagWords.join(" "));
  }
  return found;
}

/** How far the top 3 channels are beyond an even split: 0 = wide open, 1 = one channel owns it. */
function dominanceOf(metrics: NicheMetrics): number {
  if (metrics.channels <= 3) return 1;
  const evenShare = 3 / metrics.channels;
  return clamp01((metrics.concentration - evenShare) / (1 - evenShare));
}

function reasonFor(metrics: NicheMetrics, smallShare: number): string {
  if (smallShare >= 0.6) return `Small channels take ${Math.round(smallShare * 100)}% of the views here`;
  if (metrics.growth !== null && metrics.growth >= 0.25) return `Views per upload up ${Math.round(metrics.growth * 100)}% lately`;
  if (metrics.viralRate >= 0.15) return `${Math.round(metrics.viralRate * 100)}% of uploads beat their channel's usual views`;
  if (metrics.competition === "low") return `Only ${metrics.activeChannels} channels posting, and the audience is there`;
  if (dominanceOf(metrics) <= 0.2) return `Views are spread across all ${metrics.channels} channels posting here`;
  return `${Math.round(metrics.medianViewsPerDay).toLocaleString("en-US")} views a day per upload, with room to grow`;
}

/** "barbarian" is a niche, "stopped" and "insane" are not. */
function looksLikeNiche(term: string): boolean {
  const words = term.split(" ");
  if (words.some((word) => BROAD_WORDS.has(word))) return false;
  // A single short word is usually filler, and verbs aren't topics.
  if (words.length === 1 && words[0]!.length < 4) return false;
  return !words.every((word) => /(?:ed|ing)$/.test(word));
}

/** Words that describe half of YouTube, so they can never be the niche itself. */
const BROAD_WORDS = new Set(
  (
    "comedy funny meme memes real fake tips hacks diy craft crafts life hack asmr edit edits clips clip moment moments compilation reaction reactions " +
    "story storytime update news review reviews guide tutorial how tips tricks facts fact top best worst insane crazy amazing satisfying oddly " +
    "money rich poor kids family friends school work home food drink music song songs dance art drawing paint build building " +
    "process idea ideas thing things stuff part parts level levels mode collab collabs version episode series content creator creators"
  ).split(" "),
);

/**
 * Mine every term in the sample, keep the ones a newcomer could break into, and
 * rank by how much demand goes to small channels.
 */
export function findUnderratedNiches(
  videos: readonly NicheVideo[],
  channels: ReadonlyMap<string, NicheChannel>,
  options: UnderratedOptions = {},
): UnderratedNiche[] {
  const { maxDominance = 0.6, minViewsPerDay = 300, max = 12, now = new Date() } = options;
  // Four channels is the floor: with three, the "top 3" is everyone.
  const minVideos = options.minVideos ?? 6;
  const minChannels = options.minChannels ?? 4;
  const minFocusedChannels = options.minFocusedChannels ?? 2;
  const maxLibraryShare = options.maxLibraryShare ?? (videos.length >= 2_000 ? 0.12 : videos.length >= 500 ? 0.2 : 0.35);

  const libraryByChannel = new Map<string, number>();
  for (const video of videos) libraryByChannel.set(video.channel_id, (libraryByChannel.get(video.channel_id) ?? 0) + 1);

  const byTerm = new Map<string, { videos: NicheVideo[]; channels: Map<string, number> }>();
  // Terms that came from niche labels rather than title words: these are known to be niches.
  const labeled = new Set<string>();
  for (const video of videos) {
    const labels = channels.get(video.channel_id)?.niche_terms ?? [];
    for (const label of labels) labeled.add(label);
    for (const term of new Set([...terms(video), ...labels])) {
      const entry = byTerm.get(term) ?? { videos: [], channels: new Map<string, number>() };
      entry.videos.push(video);
      entry.channels.set(video.channel_id, (entry.channels.get(video.channel_id) ?? 0) + 1);
      byTerm.set(term, entry);
    }
  }

  const candidates: UnderratedNiche[] = [];
  for (const [term, entry] of byTerm) {
    if (entry.videos.length < minVideos || entry.channels.size < minChannels) continue;
    // A real niche is what its channels are about, not a word they sprinkle in.
    // "clash royale" fills those channels' uploads; "actually" appears once each.
    const focused = [...entry.channels].filter(([id, count]) => count >= 2 && count / (libraryByChannel.get(id) ?? count) >= FOCUS_SHARE).length;
    if (focused < minFocusedChannels) continue;
    // Words like "funny" or "tips" show up everywhere; a niche is narrower than that.
    if (entry.videos.length > videos.length * maxLibraryShare) continue;
    if (!labeled.has(term) && !looksLikeNiche(term)) continue;

    const metrics = computeNicheMetrics(entry.videos, channels, now);
    if (metrics.medianViewsPerDay < minViewsPerDay) continue;
    // With four channels the top three always hold ~75%, so measure against an even split.
    if (dominanceOf(metrics) > maxDominance) continue;

    let smallViews = 0;
    let totalViews = 0;
    for (const video of entry.videos) {
      const subs = channels.get(video.channel_id)?.subscriber_count ?? null;
      totalViews += video.view_count;
      if (subs !== null && subs < SMALL_CHANNEL_SUBS) smallViews += video.view_count;
    }
    const smallChannelViewShare = totalViews > 0 ? smallViews / totalViews : 0;
    // Saturated: the audience only watches the big accounts.
    if (smallChannelViewShare < 0.25) continue;

    const demand = clamp01(Math.log10(metrics.medianViewsPerDay + 1) / 5);
    const growth = metrics.growth === null ? 0.5 : clamp01((metrics.growth + 0.5) / 1.5);
    const viral = clamp01(metrics.viralRate / 0.25);
    const room = clamp01(1 - dominanceOf(metrics));
    const score = Math.round(100 * (0.3 * smallChannelViewShare + 0.25 * demand + 0.2 * viral + 0.15 * room + 0.1 * growth));
    candidates.push({ term, metrics, score, smallChannelViewShare: Math.round(smallChannelViewShare * 1000) / 1000, reason: reasonFor(metrics, smallChannelViewShare) });
  }

  // "clash royale" says more than "clash", so a two-word niche wins ties with its own words.
  const specificity = (niche: UnderratedNiche) => niche.score + (labeled.has(niche.term) ? 8 : 0) + (niche.term.includes(" ") ? 4 : 0);
  const chosen: UnderratedNiche[] = [];
  for (const candidate of candidates.sort((a, b) => specificity(b) - specificity(a) || a.term.localeCompare(b.term))) {
    if (chosen.length >= max) break;
    const words = new Set(candidate.term.split(" "));
    if (chosen.some((c) => c.term.split(" ").some((word) => words.has(word)))) continue;
    chosen.push(candidate);
  }
  return chosen;
}

/** Videos published within the window the miner looks at. */
export function underratedWindow(now: Date, days = 90): Date {
  return new Date(now.getTime() - days * DAY);
}
