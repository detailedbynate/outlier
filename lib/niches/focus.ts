/**
 * Whether a channel is actually about a topic, judged on the channel as a whole.
 * One upload that mentions "crime" doesn't make Vsauce a crime channel; a channel
 * of TV-show clips tagged #crime isn't a crime creator either.
 */

import { keywordTokens, mentionsKeywords } from "@/lib/research/relevance";

export interface ChannelProfile {
  topicCategories: string[];
  description: string | null;
  /** 'en', 'other', or null when unknown. */
  contentLanguage: string | null;
  uploads: { title: string; tags: string[] }[];
}

/** A topic has to show up in this many recent uploads, and this share of them. */
export const FOCUS_MIN_HITS = 3;
export const FOCUS_MIN_SHARE = 0.3;

const REEDITED = /(re-?edit(ed|s)?|re-?upload|clips? from|all rights (belong|go|reserved) to|no copyright infringement|i do not own|not my (video|content)|copyright disclaimer)/i;

/** How many recent uploads mention every meaningful word of the topic. */
export function topicFocus(uploads: ChannelProfile["uploads"], topic: string): { hits: number; share: number } {
  const tokens = keywordTokens(topic);
  if (uploads.length === 0 || tokens.length === 0) return { hits: 0, share: 0 };
  const hits = uploads.filter((u) => mentionsKeywords(`${u.title} ${u.tags.join(" ")}`, tokens)).length;
  return { hits, share: hits / uploads.length };
}

/**
 * Channels that post TV and movie clips: YouTube tags them as television programs,
 * or they say their videos are re-edited or someone else's.
 */
export function isClipChannel(profile: Pick<ChannelProfile, "topicCategories" | "description">): boolean {
  if (profile.topicCategories.some((url) => /Television_program/i.test(url))) return true;
  return REEDITED.test(profile.description ?? "");
}

/** A channel that isn't confidently labeled with the topic still counts when most of its work is about it. */
export function isAboutTopic(profile: ChannelProfile, topic: string): boolean {
  if (profile.contentLanguage === "other") return false;
  if (isClipChannel(profile)) return false;
  const { hits, share } = topicFocus(profile.uploads, topic);
  return hits >= FOCUS_MIN_HITS && share >= FOCUS_MIN_SHARE;
}
