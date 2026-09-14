import type { YouTubeChannel, YouTubeVideo } from "@/types/youtube";

/**
 * Outlier quality rules: keep original, English-market videos from small
 * channels that are genuinely overperforming, and drop junk. Pure functions,
 * shared by Trending Today and Discovery.
 */

export interface QualityConfig {
  /** ISO 639-1 language to keep, e.g. "en". */
  language: string;
  /** Channel countries to accept when the channel lists one (unlisted is allowed). */
  countries: readonly string[];
  minViews: number;
  maxSubscribers: number;
  /** Views must be at least this multiple of subscribers. */
  minViewsPerSubscriber: number;
  /** (likes + comments) / views. */
  minEngagement: number;
  /** The channel needs at least this many uploads (filters one-hit reupload accounts). */
  minChannelVideos: number;
  minDurationSeconds: number;
}

export const DEFAULT_QUALITY: QualityConfig = {
  language: "en",
  countries: ["US", "GB", "CA", "AU", "NZ", "IE"],
  minViews: 100_000,
  maxSubscribers: 100_000,
  minViewsPerSubscriber: 10,
  minEngagement: 0.01,
  minChannelVideos: 5,
  minDurationSeconds: 10,
};

export type RejectReason =
  | "language"
  | "country"
  | "made_for_kids"
  | "too_short"
  | "spam_title"
  | "low_views"
  | "too_big"
  | "hidden_subscribers"
  | "low_ratio"
  | "low_engagement"
  | "tiny_channel";

const SPAM_PATTERNS = [
  /\bcompilation\b/i,
  /\bre-?upload(ed)?\b/i,
  /\bfull movie\b/i,
  /\bfull episode\b/i,
  /\bfree (robux|v-?bucks|gift ?cards?)\b/i,
  /\bnot mine\b/i,
  /\bcredit(s)? to\b/i,
  /\bno copyright\b/i,
  /\blive ?stream\b/i,
  /\b(sub|subscribe) for sub\b/i,
];

/** Share of letters that are Latin script. Titles in other scripts score low. */
export function latinLetterShare(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 1;
  const latin = letters.filter((ch) => /\p{Script=Latin}/u.test(ch)).length;
  return latin / letters.length;
}

/** True when a title is mostly hashtags/emoji rather than words. */
export function isSpammyTitle(title: string): boolean {
  const tokens = title.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hashtags = tokens.filter((t) => t.startsWith("#")).length;
  const words = tokens.filter((t) => !t.startsWith("#") && /\p{L}{2,}/u.test(t)).length;
  const emoji = (title.match(/\p{Extended_Pictographic}/gu) ?? []).length;
  if (hashtags >= 4 && hashtags >= words) return true;
  if (words === 0) return true;
  if (emoji >= 6 && emoji > words) return true;
  return SPAM_PATTERNS.some((pattern) => pattern.test(title));
}

function languageMatches(code: string | null | undefined, language: string): boolean | null {
  if (!code) return null;
  return code.toLowerCase() === language || code.toLowerCase().startsWith(`${language}-`);
}

export interface LanguageSample {
  title: string;
  defaultAudioLanguage?: string | null;
  defaultLanguage?: string | null;
}

/**
 * Detect whether a channel's recent uploads are in `language`: declared audio/default
 * languages win; otherwise the share of titles written mostly in Latin script decides.
 * Returns the language code, "other", or null when there isn't enough to tell.
 */
export function detectContentLanguage(samples: readonly LanguageSample[], language = "en"): string | null {
  if (samples.length === 0) return null;
  let declaredMatch = 0;
  let declaredOther = 0;
  let latinTitles = 0;
  for (const sample of samples) {
    const declared = languageMatches(sample.defaultAudioLanguage, language) ?? languageMatches(sample.defaultLanguage, language);
    if (declared === true) declaredMatch += 1;
    else if (declared === false) declaredOther += 1;
    if (latinLetterShare(sample.title) >= 0.85) latinTitles += 1;
  }
  const declared = declaredMatch + declaredOther;
  if (declared >= Math.max(2, samples.length * 0.3)) return declaredMatch >= declaredOther ? language : "other";
  if (language !== "en") return null;
  return latinTitles / samples.length >= 0.7 ? language : "other";
}

export function engagementRate(video: YouTubeVideo): number | null {
  const views = video.statistics.viewCount;
  const { likeCount, commentCount } = video.statistics;
  if (views <= 0 || (likeCount === null && commentCount === null)) return null;
  return ((likeCount ?? 0) + (commentCount ?? 0)) / views;
}

/**
 * Why a video/channel pair fails the quality bar, or null when it passes.
 * `sizeRules: false` keeps the language/junk/engagement checks but allows big channels
 * (used by niche discovery, where users filter by size themselves).
 */
export function rejectReason(
  video: YouTubeVideo,
  channel: YouTubeChannel,
  config: QualityConfig = DEFAULT_QUALITY,
  options: { sizeRules?: boolean } = {},
): RejectReason | null {
  const sizeRules = options.sizeRules ?? true;
  // Language: trust explicit metadata first, then fall back to the title's script.
  const declared = languageMatches(video.defaultAudioLanguage, config.language) ?? languageMatches(video.defaultLanguage, config.language);
  if (declared === false) return "language";
  if (declared === null && config.language === "en" && latinLetterShare(video.title) < 0.85) return "language";

  if (channel.country && !config.countries.includes(channel.country.toUpperCase())) return "country";
  if (video.madeForKids || channel.madeForKids) return "made_for_kids";
  if (video.durationSeconds !== null && video.durationSeconds < config.minDurationSeconds) return "too_short";
  if (isSpammyTitle(video.title)) return "spam_title";

  const views = video.statistics.viewCount;
  if (views < config.minViews) return "low_views";
  if (sizeRules) {
    const subscribers = channel.statistics.subscriberCount;
    if (subscribers === null) return "hidden_subscribers";
    if (subscribers > config.maxSubscribers) return "too_big";
    if (views / Math.max(subscribers, 1) < config.minViewsPerSubscriber) return "low_ratio";
  }

  const engagement = engagementRate(video);
  if (engagement === null || engagement < config.minEngagement) return "low_engagement";
  if (channel.statistics.videoCount < config.minChannelVideos) return "tiny_channel";
  return null;
}

/**
 * Underrated score: rewards views far above the channel's size, with a boost
 * for strong engagement and a gentle nod to absolute reach. Higher is better.
 */
export function underratedScore(video: YouTubeVideo, channel: YouTubeChannel): number {
  const views = video.statistics.viewCount;
  const subscribers = Math.max(channel.statistics.subscriberCount ?? 0, 500);
  const ratio = Math.min(views / subscribers, 1_000);
  const engagement = engagementRate(video) ?? 0;
  const engagementBoost = 1 + Math.min(engagement, 0.15) * 4; // up to 1.6×
  return Math.sqrt(ratio) * Math.log10(Math.max(views, 10)) * engagementBoost;
}

export function qualityConfigFrom(env: {
  OUTLIER_LANGUAGE: string;
  OUTLIER_COUNTRIES: string;
  OUTLIER_MIN_VIEWS: number;
  OUTLIER_MAX_SUBSCRIBERS: number;
  OUTLIER_MIN_VIEWS_PER_SUB: number;
  OUTLIER_MIN_ENGAGEMENT: number;
}): QualityConfig {
  return {
    ...DEFAULT_QUALITY,
    language: env.OUTLIER_LANGUAGE.toLowerCase(),
    countries: env.OUTLIER_COUNTRIES.split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean),
    minViews: env.OUTLIER_MIN_VIEWS,
    maxSubscribers: env.OUTLIER_MAX_SUBSCRIBERS,
    minViewsPerSubscriber: env.OUTLIER_MIN_VIEWS_PER_SUB,
    minEngagement: env.OUTLIER_MIN_ENGAGEMENT,
  };
}
