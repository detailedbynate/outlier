import { NICHE_DICTIONARY } from "./dictionary";
import { creatorsFor, examplesFor, type NicheCreator, type NicheExample } from "./examples";
import { canonicalNiche, displayNicheName, isUsefulNiche, nicheKey, normalizeName } from "./naming";

/**
 * Niche analysis from stored videos and channels. Pure functions, no I/O:
 * sub-niche discovery from titles and tags, per-niche metrics, and opportunity scoring.
 */

export interface NicheVideo {
  id: string;
  youtube_video_id: string;
  channel_id: string;
  title: string;
  tags: string[];
  format: string;
  view_count: number;
  like_count: number | null;
  comment_count: number | null;
  published_at: string;
  /** Views vs the channel's typical upload, when computed. */
  outlier_score: number | null;
}

export interface NicheChannel {
  id: string;
  youtube_channel_id: string;
  title: string;
  thumbnail_url: string | null;
  subscriber_count: number | null;
  /** Niche labels when the channel has been labeled: its game or topic, then its sub-niches. */
  niche_terms?: string[];
}

export type Level = "low" | "medium" | "high";

export interface NicheMetrics {
  videos: number;
  channels: number;
  activeChannels: number;
  uploads30d: number;
  avgViews: number;
  medianViews: number;
  /** Median views per day since upload (recent uploads). */
  medianViewsPerDay: number;
  /** Change in views/day of recent uploads vs older ones (e.g. 0.35 = +35%); null without enough data. */
  growth: number | null;
  /** Share of views captured by the top 3 channels (0-1). */
  concentration: number;
  competition: Level;
  demand: Level;
  /** Share of videos performing 3x+ their channel's typical upload. */
  viralRate: number;
  /** Share of breakouts from channels under 100K subscribers (null with no breakouts). */
  smallChannelShare: number | null;
  format: { shorts: number; longForm: number; shortsViewsPerDay: number | null; longViewsPerDay: number | null; best: "shorts" | "long_form" | "both" | "unknown" };
  opportunity: number;
  confidence: Level;
  topChannels: { youtube_channel_id: string; title: string; thumbnail_url: string | null; subscriber_count: number | null; videos: number; views: number }[];
  breakouts: { youtube_video_id: string; title: string; channel_title: string; view_count: number; multiplier: number; format: string; published_at: string }[];
}

export interface SubNiche {
  term: string;
  metrics: NicheMetrics;
  /** Uploads from smaller channels that beat their size (missing on reports cached before this existed). */
  examples?: NicheExample[];
  creators?: NicheCreator[];
}

const DAY = 86_400_000;
const VIRAL_MULTIPLIER = 3;
const SMALL_CHANNEL_SUBS = 100_000;
/** Breakouts kept in a report. Wide enough that filtering by topic and format still leaves a pattern. */
const BREAKOUT_POOL = 24;

const STOPWORDS = new Set(
  (
    "the a an and or but of to in on for with at by from is are was were be been it this that these those you your my me we our i he she they them his her " +
    "how what why when who which vs versus not no yes so do does did can will just get got make made new best top most more very all any every into out up " +
    "shorts short video videos viral fyp foryou foryoupage youtube subscribe like comment share trending official full part episode ep day days time " +
    "watch live stream today first last one two three 1st challenge try tried trying ever really good bad easy hard try amp quot " +
    // Verbs and connectives that show up in half of all titles.
    "have has had having want wants wanted need needs going go goes went come comes came take takes took give gives gave know knows knew " +
    "think thinks thought say says said see sees saw look looks looked use uses used work works worked feel feels felt keep keeps kept " +
    "about after again against because before between during more much never now only other over same still such than then there these " +
    "through under until while why would could should might must also back down even here" +
    " " +
    // Broad category words say nothing about a sub-niche.
    "game games gaming gamer gameplay gamers gameplays vlog vlogs tiktok reels reel edit edits"
  ).split(/\s+/),
);

/** Lowercase, trimmed, single-spaced key (also the cache key). */
export function topicKey(topic: string): string {
  return topic
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9 &'+.-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export function tokenize(text: string): string[] {
  return text
    // Accents fold into their base letter first; splitting on them turned "Pokémon" into "pok" and "mon".
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/#/g, " ")
    .split(/[^a-z0-9']+/)
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !STOPWORDS.has(t));
}

/** Terms in one video: title unigrams and bigrams, plus single-word and two-word tags. */
function videoTerms(video: Pick<NicheVideo, "title" | "tags">, exclude: Set<string>): Set<string> {
  const terms = new Set<string>();
  const words = tokenize(video.title).filter((w) => !exclude.has(w));
  for (let i = 0; i < words.length; i++) {
    terms.add(words[i]!);
    if (i + 1 < words.length) terms.add(`${words[i]} ${words[i + 1]}`);
  }
  for (const tag of video.tags.slice(0, 30)) {
    const tagWords = tokenize(tag).filter((w) => !exclude.has(w));
    if (tagWords.length === 1 || tagWords.length === 2) terms.add(tagWords.join(" "));
  }
  return terms;
}

/** Other names for a topic from the niche dictionary ("my singing monsters" -> "msm", "mysingingmonsters"). */
export function topicAliases(topic: string): string[] {
  const key = normalizeName(topic);
  const entry = NICHE_DICTIONARY.find((e) => normalizeName(e.name) === key || e.aliases.some((a) => normalizeName(a) === key));
  if (!entry) return [];
  return [...new Set([entry.name, ...entry.aliases].map(normalizeName).filter((a) => a && a !== key))];
}


/**
 * Sub-niches that actually appear in the data: terms shared by several videos
 * from several channels, excluding the topic itself. Overlapping terms are
 * collapsed (e.g. "minecraft" beats "minecraft build").
 */
export function discoverSubNiches(
  videos: readonly NicheVideo[],
  topic: string,
  max = 8,
  /** Niche labels for the channels in the sample: terms already known to be niches. */
  labeled: ReadonlySet<string> = new Set(),
): { term: string; videoIds: Set<string> }[] {
  const topicWords = topic.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  // "msm" is just My Singing Monsters again, not a niche inside it.
  const aliasWords = topicAliases(topic).flatMap((alias) => [...alias.split(" "), alias.replace(/ /g, "")]);
  const exclude = new Set([...tokenize(topic), topicWords.join(""), ...aliasWords]);
  // Variants of the topic ("game" for "gaming", "cooks" for "cooking") aren't sub-niches either.
  const isTopicVariant = (term: string) =>
    term.split(" ").every((word) => topicWords.some((t) => t.length >= 4 && word.length >= 4 && (t.startsWith(word.slice(0, 4)) || word.startsWith(t.slice(0, 4)))));
  const byTerm = new Map<string, { videos: Set<string>; channels: Set<string> }>();
  for (const video of videos) {
    for (const term of videoTerms(video, exclude)) {
      const entry = byTerm.get(term) ?? { videos: new Set(), channels: new Set() };
      entry.videos.add(video.id);
      entry.channels.add(video.channel_id);
      byTerm.set(term, entry);
    }
  }

  const minVideos = Math.max(3, Math.ceil(videos.length * 0.02));
  const titlesById = new Map(videos.map((v) => [v.id, v.title]));
  const candidates = [...byTerm.entries()]
    .filter(([term, e]) => e.videos.size >= minVideos && e.channels.size >= 2 && !isTopicVariant(term))
    // A term dominating the whole sample is a synonym of the topic, not a sub-niche.
    .filter(([, e]) => e.videos.size <= videos.length * 0.8)
    // "update" and "lore" are what these uploads say, not what they are about.
    .filter(([term, e]) => isUsefulNiche(term, { labeled, titles: [...e.videos].map((id) => titlesById.get(id) ?? "") }))
    .map(([term, e]) => ({ term, videoIds: e.videos, score: e.videos.size * Math.log2(1 + e.channels.size) }))
    .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));

  const chosen: { term: string; videoIds: Set<string> }[] = [];
  const takenNames = new Set<string>();
  // "arthur morgan" reads better than "arthurmorgan": when both were mined, keep the spaced one.
  const spaced = new Set(candidates.filter((c) => c.term.includes(" ")).map((c) => nicheKey(c.term)));
  for (const candidate of candidates) {
    if (!candidate.term.includes(" ") && spaced.has(nicheKey(candidate.term)) && !canonicalNiche(candidate.term)) continue;
    if (chosen.length >= max) break;
    const words = new Set(candidate.term.split(" "));
    if (chosen.some((c) => normalizeName(c.term).split(" ").some((w) => words.has(w)))) continue;
    // "rdr2" and "red dead" are one niche under one name, so only the first of them shows.
    const name = displayNicheName(candidate.term);
    if (takenNames.has(nicheKey(name))) continue;
    takenNames.add(nicheKey(name));
    chosen.push({ term: name, videoIds: candidate.videoIds });
  }
  return chosen;
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);
const round = (n: number, digits = 0) => Math.round(n * 10 ** digits) / 10 ** digits;

export function computeNicheMetrics(videos: readonly NicheVideo[], channels: ReadonlyMap<string, NicheChannel>, now: Date = new Date()): NicheMetrics {
  const ageDays = (v: NicheVideo) => Math.max((now.getTime() - Date.parse(v.published_at)) / DAY, 1);
  const vpd = (v: NicheVideo) => v.view_count / ageDays(v);
  const recent = videos.filter((v) => ageDays(v) <= 30);

  // Channel baselines inside the sample, used when a stored outlier score is missing.
  const byChannel = new Map<string, NicheVideo[]>();
  for (const v of videos) byChannel.set(v.channel_id, [...(byChannel.get(v.channel_id) ?? []), v]);
  const multiplier = (v: NicheVideo): number | null => {
    if (v.outlier_score !== null) return Number(v.outlier_score);
    const peers = byChannel.get(v.channel_id) ?? [];
    if (peers.length < 3) return null;
    const base = median(peers.map((p) => p.view_count));
    return base > 0 ? v.view_count / base : null;
  };

  // Growth: views/day of uploads from the last 14 days vs 15-60 days old.
  const fresh = videos.filter((v) => ageDays(v) <= 14).map(vpd);
  const older = videos.filter((v) => ageDays(v) > 14 && ageDays(v) <= 60).map(vpd);
  const growth = fresh.length >= 3 && older.length >= 3 && median(older) > 0 ? round(median(fresh) / median(older) - 1, 3) : null;

  // Competition: how concentrated views are among the top channels.
  const viewsByChannel = new Map<string, { views: number; videos: number }>();
  for (const v of videos) {
    const e = viewsByChannel.get(v.channel_id) ?? { views: 0, videos: 0 };
    e.views += v.view_count;
    e.videos += 1;
    viewsByChannel.set(v.channel_id, e);
  }
  const totalViews = [...viewsByChannel.values()].reduce((s, e) => s + e.views, 0);
  const ranked = [...viewsByChannel.entries()].sort((a, b) => b[1].views - a[1].views);
  const concentration = totalViews > 0 ? ranked.slice(0, 3).reduce((s, [, e]) => s + e.views, 0) / totalViews : 1;

  const scored = videos.map((v) => ({ v, m: multiplier(v) })).filter((x): x is { v: NicheVideo; m: number } => x.m !== null);
  const viral = scored.filter((x) => x.m >= VIRAL_MULTIPLIER);
  const viralRate = scored.length > 0 ? viral.length / scored.length : 0;
  const smallChannelShare =
    viral.length > 0 ? viral.filter((x) => (channels.get(x.v.channel_id)?.subscriber_count ?? Infinity) < SMALL_CHANNEL_SUBS).length / viral.length : null;

  const shorts = videos.filter((v) => v.format === "short");
  const longs = videos.filter((v) => v.format === "long_form");
  const shortsVpd = shorts.length >= 3 ? median(shorts.map(vpd)) : null;
  const longVpd = longs.length >= 3 ? median(longs.map(vpd)) : null;
  const best: NicheMetrics["format"]["best"] =
    shortsVpd === null && longVpd === null
      ? "unknown"
      : longVpd === null
        ? "shorts"
        : shortsVpd === null
          ? "long_form"
          : shortsVpd > longVpd * 1.5
            ? "shorts"
            : longVpd > shortsVpd * 1.5
              ? "long_form"
              : "both";

  const medianVpd = median((recent.length >= 3 ? recent : videos).map(vpd));
  const activeChannels = new Set(recent.map((v) => v.channel_id)).size;

  // Opportunity: demand, momentum, breakout potential, room for small channels, spread-out competition.
  const demandScore = clamp01(Math.log10(medianVpd + 1) / 5);
  const growthScore = growth === null ? 0.5 : clamp01((growth + 0.5) / 1.5);
  const viralScore = clamp01(viralRate / 0.25);
  const smallScore = smallChannelShare ?? 0.5;
  const competitionScore = clamp01(1 - concentration);
  const opportunity = Math.round(100 * (0.3 * demandScore + 0.2 * growthScore + 0.2 * viralScore + 0.15 * smallScore + 0.15 * competitionScore));

  const level = (value: number, low: number, high: number): Level => (value >= high ? "high" : value >= low ? "medium" : "low");

  return {
    videos: videos.length,
    channels: viewsByChannel.size,
    activeChannels,
    uploads30d: recent.length,
    avgViews: videos.length ? Math.round(totalViews / videos.length) : 0,
    medianViews: Math.round(median(videos.map((v) => v.view_count))),
    medianViewsPerDay: Math.round(medianVpd),
    growth,
    concentration: round(concentration, 3),
    competition: activeChannels >= 25 || concentration >= 0.7 ? "high" : activeChannels >= 10 || concentration >= 0.45 ? "medium" : "low",
    demand: level(medianVpd, 1_000, 20_000),
    viralRate: round(viralRate, 3),
    smallChannelShare: smallChannelShare === null ? null : round(smallChannelShare, 3),
    format: { shorts: shorts.length, longForm: longs.length, shortsViewsPerDay: shortsVpd === null ? null : Math.round(shortsVpd), longViewsPerDay: longVpd === null ? null : Math.round(longVpd), best },
    opportunity,
    confidence: videos.length >= 60 && viewsByChannel.size >= 15 ? "high" : videos.length >= 15 && viewsByChannel.size >= 5 ? "medium" : "low",
    topChannels: ranked.slice(0, 5).flatMap(([id, e]) => {
      const c = channels.get(id);
      return c ? [{ youtube_channel_id: c.youtube_channel_id, title: c.title, thumbnail_url: c.thumbnail_url, subscriber_count: c.subscriber_count, videos: e.videos, views: e.views }] : [];
    }),
    // A pool, not a display list: the Shorts writer filters these down to the
    // ones actually about the topic, and pages that show breakouts slice their own.
    breakouts: [...viral]
      .sort((a, b) => b.m - a.m)
      .slice(0, BREAKOUT_POOL)
      .map(({ v, m }) => ({
        youtube_video_id: v.youtube_video_id,
        title: v.title,
        channel_title: channels.get(v.channel_id)?.title ?? "",
        view_count: v.view_count,
        multiplier: round(m, 1),
        format: v.format,
        published_at: v.published_at,
      })),
  };
}

export interface NicheReport {
  topic: string;
  overall: NicheMetrics;
  subNiches: SubNiche[];
}

/** Full report: the topic overall plus discovered sub-niches, best opportunities first. */
export function buildNicheReport(topic: string, videos: readonly NicheVideo[], channels: ReadonlyMap<string, NicheChannel>, now: Date = new Date()): NicheReport {
  const byId = new Map(videos.map((v) => [v.id, v]));
  // What the labeler already decided these channels are about beats anything mined from titles.
  const labeled = new Set([...channels.values()].flatMap((c) => c.niche_terms ?? []));
  const subNiches = discoverSubNiches(videos, topic, 8, labeled)
    .map(({ term, videoIds }) => {
      const subVideos = [...videoIds].map((id) => byId.get(id)!);
      return {
        term,
        metrics: computeNicheMetrics(subVideos, channels, now),
        examples: examplesFor(subVideos, channels, 6),
        creators: creatorsFor(subVideos, channels),
      };
    })
    .sort((a, b) => b.metrics.opportunity - a.metrics.opportunity);
  return { topic, overall: computeNicheMetrics(videos, channels, now), subNiches };
}
