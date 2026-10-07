import type { NicheChannel, NicheVideo } from "./analysis";
import type { NicheCategory } from "./labeling";
import { categoriesIn, categoryFor, rpmFor } from "./revenue";

/**
 * Breakouts in paying niches: recent uploads from small channels that pulled
 * many times their subscriber count, in categories where a view is worth
 * something. A gaming Short with 2M views on a 5K channel is common; a Roth IRA
 * explainer doing 200K on a 3K channel is a niche telling you it's open.
 */

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
}

const DAY_MS = 86_400_000;

/** Low-paying signals in the video itself: a meme about money is still a meme. */
const LOW_PAY: ReadonlySet<NicheCategory> = new Set(["Gaming", "Sports", "Comedy & Skits", "Entertainment & Pop Culture", "Music & Dance"]);
const ENTERTAINMENT = /(satisfying|asmr|#viral|#fyp|story ?time|beamng|roblox|fortnite|nintendo|xbox|playstation|garry.?s mod|wwe\b|wrestl|formula ?1|#f1\b|verstappen)/i;

const textOf = (video: NicheVideo) => [video.title, ...video.tags.slice(0, 8)].join(" ");

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
    if (rpm[0] < minRpm) continue;
    const text = textOf(video);
    if (ENTERTAINMENT.test(text) || categoriesIn(text).some((c) => LOW_PAY.has(c))) continue;
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
    });
  }
  // Pay matters as much as lift: a 10x finance video beats a 40x DIY one.
  return [...best.values()].sort((a, b) => Math.sqrt(b.lift) * b.rpm[0] - Math.sqrt(a.lift) * a.rpm[0]).slice(0, options.limit ?? 12);
}
