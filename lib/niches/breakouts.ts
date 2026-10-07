import type { NicheChannel, NicheVideo } from "./analysis";
import type { NicheCategory } from "./labeling";
import { categoriesIn, categoryFor, rpmFor } from "./revenue";
import { gameIn } from "./rule-labeler";

/**
 * Breakouts in paying niches: recent uploads from small channels that pulled
 * many times their subscriber count, in categories where a view is worth
 * something. A gaming Short with 2M views on a 5K channel is common; a Roth IRA
 * explainer doing 200K on a 3K channel is a niche telling you it's open.
 *
 * The gaming lens turns that around for gaming creators: only gaming, ranked on
 * views and lift (every game pays about the same), each tagged with its game.
 */

/** "paying": categories where a view is worth more. "gaming": gaming only, ranked on views. */
export type IdeaLens = "paying" | "gaming";

export interface Breakout {
  youtubeVideoId: string;
  title: string;
  channelTitle: string;
  views: number;
  subscribers: number | null;
  /** Views per subscriber (subscribers floored at 1,000). */
  lift: number;
  category: NicheCategory;
  /** Long-form RPM range for the category, as a pay hint. */
  rpm: [number, number];
  format: "short" | "long_form";
  publishedAt: string;
  /** The channel's age in days, when known. */
  channelAgeDays: number | null;
  /** The game it's about, when the dictionary knows it. */
  game: string | null;
}

/** A channel under six months old that's already pulling real views in a paying niche. */
export interface RisingChannel {
  youtubeChannelId: string;
  title: string;
  thumbnailUrl: string | null;
  subscribers: number | null;
  ageDays: number;
  uploads: number;
  medianViews: number;
  category: NicheCategory;
  rpm: [number, number];
  game: string | null;
  /** Its best upload in the sample. */
  top: { youtubeVideoId: string; title: string; views: number; format: "short" | "long_form" };
}

export interface BreakoutOptions {
  now?: Date;
  days?: number;
  maxSubscribers?: number;
  minViews?: number;
  minLift?: number;
  /** Lowest long-form RPM (low end of the band) that counts as paying. */
  minRpm?: number;
  /** Uploads an unlabeled channel needs in the sample before its topic is trusted. */
  minUploads?: number;
  limit?: number;
  lens?: IdeaLens;
}

const DAY_MS = 86_400_000;

/** Low-paying signals in the video itself: a meme about money is still a meme. */
const LOW_PAY: ReadonlySet<NicheCategory> = new Set(["Gaming", "Sports", "Comedy & Skits", "Entertainment & Pop Culture", "Music & Dance"]);
const ENTERTAINMENT = /(satisfying|asmr|#viral|#fyp|story ?time|beamng|roblox|fortnite|nintendo|xbox|playstation|garry.?s mod|wwe\b|wrestl|formula ?1|#f1\b|verstappen)/i;

const textOf = (video: NicheVideo) => [video.title, ...video.tags.slice(0, 8)].join(" ");

/** Fits the lens: gaming only for gaming, and paying (and not entertainment in disguise) otherwise. */
function fits(lens: IdeaLens, category: NicheCategory, rpm: [number, number], minRpm: number, text: string): boolean {
  // A gaming channel's movie video isn't a gaming breakout: the video has to read as gaming, or at least as nothing else.
  if (lens === "gaming") {
    const said = categoriesIn(text);
    return category === "Gaming" && (said.length === 0 || said.includes("Gaming") || gameIn(text) !== null);
  }
  return rpm[0] >= minRpm && !ENTERTAINMENT.test(text) && !categoriesIn(text).some((c) => LOW_PAY.has(c));
}

/** The video's game, else the channel's. */
const gameOf = (text: string, channel: NicheChannel) => gameIn(text) ?? (channel.niche_terms?.length ? gameIn(channel.niche_terms.join(" ")) : null);

const ageInDays = (channel: NicheChannel, now: Date): number | null => {
  const created = channel.published_at ? Date.parse(channel.published_at) : NaN;
  return Number.isFinite(created) ? Math.max(0, Math.floor((now.getTime() - created) / DAY_MS)) : null;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * What each channel is about. Labeled channels use their labels; the rest need
 * most of their uploads in the sample to point the same way, since one title
 * ("my car got smashed", "making too much money") says little.
 */
function channelCategories(videos: readonly NicheVideo[], channels: ReadonlyMap<string, NicheChannel>, minUploads: number): Map<string, NicheCategory> {
  const votes = new Map<string, { total: number; by: Map<NicheCategory, number> }>();
  for (const video of videos) {
    const entry = votes.get(video.channel_id) ?? { total: 0, by: new Map<NicheCategory, number>() };
    entry.total++;
    const category = categoryFor(textOf(video));
    if (category) entry.by.set(category, (entry.by.get(category) ?? 0) + 1);
    votes.set(video.channel_id, entry);
  }
  const result = new Map<string, NicheCategory>();
  for (const [id, { total, by }] of votes) {
    const channel = channels.get(id);
    if (!channel) continue;
    if (channel.niche_terms?.length) {
      const labeled = categoryFor(...channel.niche_terms);
      if (labeled) result.set(id, labeled);
      continue;
    }
    if (total < minUploads) continue;
    const top = [...by].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] * 2 >= total) result.set(id, top[0]);
  }
  return result;
}

export function findBreakouts(videos: readonly NicheVideo[], channels: ReadonlyMap<string, NicheChannel>, options: BreakoutOptions = {}): Breakout[] {
  const now = options.now ?? new Date();
  const since = now.getTime() - (options.days ?? 14) * DAY_MS;
  const maxSubs = options.maxSubscribers ?? 100_000;
  const minViews = options.minViews ?? 20_000;
  const minLift = options.minLift ?? 3;
  const minRpm = options.minRpm ?? 3;
  const lens = options.lens ?? "paying";

  const categories = channelCategories(videos, channels, options.minUploads ?? 3);
  const best = new Map<string, Breakout>();
  for (const video of videos) {
    if (video.view_count < minViews || Date.parse(video.published_at) < since) continue;
    const channel = channels.get(video.channel_id);
    const category = categories.get(video.channel_id);
    if (!channel || !category) continue;
    const subscribers = channel.subscriber_count;
    if (subscribers !== null && subscribers > maxSubs) continue;
    const lift = video.view_count / Math.max(subscribers ?? 0, 1_000);
    if (lift < minLift) continue;
    const rpm = rpmFor(category, "long_form");
    const text = textOf(video);
    if (!fits(lens, category, rpm, minRpm, text)) continue;
    // One per channel, so a single hot channel doesn't fill the feed.
    const current = best.get(video.channel_id);
    if (current && current.lift >= lift) continue;
    best.set(video.channel_id, {
      youtubeVideoId: video.youtube_video_id,
      title: video.title,
      channelTitle: channel.title,
      views: video.view_count,
      subscribers,
      lift,
      category,
      rpm,
      format: video.format === "short" ? "short" : "long_form",
      publishedAt: video.published_at,
      channelAgeDays: ageInDays(channel, now),
      game: gameOf(text, channel),
    });
  }
  // Pay matters as much as lift: a 10x finance video beats a 40x DIY one. In gaming, views do.
  const weight = (b: Breakout) => Math.sqrt(b.lift) * (lens === "gaming" ? Math.log10(b.views) : b.rpm[0]);
  return [...best.values()].sort((a, b) => weight(b) - weight(a)).slice(0, options.limit ?? 12);
}

/**
 * Channels started in the last six months whose typical upload already does
 * well, in categories that pay at least middling RPM ($2+ long-form). One viral
 * video can be luck; a new channel whose median upload pulls 20K views found a
 * niche with room in it.
 */
export function findRisingChannels(
  videos: readonly NicheVideo[],
  channels: ReadonlyMap<string, NicheChannel>,
  options: { now?: Date; maxAgeDays?: number; minUploads?: number; minMedianViews?: number; minRpm?: number; limit?: number; lens?: IdeaLens } = {},
): RisingChannel[] {
  const now = options.now ?? new Date();
  const lens = options.lens ?? "paying";
  const maxAge = options.maxAgeDays ?? 180;
  const minUploads = options.minUploads ?? 3;
  const categories = channelCategories(videos, channels, minUploads);
  const byChannel = new Map<string, NicheVideo[]>();
  for (const video of videos) {
    const list = byChannel.get(video.channel_id) ?? [];
    list.push(video);
    byChannel.set(video.channel_id, list);
  }
  const out: RisingChannel[] = [];
  for (const [id, uploads] of byChannel) {
    const channel = channels.get(id);
    const category = categories.get(id);
    if (!channel || !category || uploads.length < minUploads) continue;
    const age = ageInDays(channel, now);
    if (age === null || age > maxAge) continue;
    const rpm = rpmFor(category, "long_form");
    if (lens === "gaming" ? category !== "Gaming" : rpm[0] < (options.minRpm ?? 2)) continue;
    const medianViews = median(uploads.map((v) => v.view_count));
    if (medianViews < (options.minMedianViews ?? 10_000)) continue;
    // The channel as a whole has to be about something that pays, not one lucky upload's topic.
    const lowPay = uploads.filter((v) => ENTERTAINMENT.test(textOf(v)) || categoriesIn(textOf(v)).some((c) => LOW_PAY.has(c))).length;
    if (lens === "paying" && lowPay * 2 >= uploads.length) continue;
    const best = uploads.reduce((a, b) => (b.view_count > a.view_count ? b : a));
    out.push({
      youtubeChannelId: channel.youtube_channel_id,
      title: channel.title,
      thumbnailUrl: channel.thumbnail_url,
      subscribers: channel.subscriber_count,
      ageDays: age,
      uploads: uploads.length,
      medianViews,
      category,
      rpm,
      game: mostCommon(uploads.map((v) => gameOf(textOf(v), channel))),
      top: { youtubeVideoId: best.youtube_video_id, title: best.title, views: best.view_count, format: best.format === "short" ? "short" : "long_form" },
    });
  }
  const weight = (c: RisingChannel) => Math.sqrt(c.medianViews) * (lens === "gaming" ? 1 : c.rpm[0]);
  return out.sort((a, b) => weight(b) - weight(a)).slice(0, options.limit ?? 9);
}

function mostCommon(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
