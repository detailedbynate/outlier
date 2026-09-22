/**
 * Which of a niche's breakouts are worth learning from.
 *
 * The niche report gathers videos by *channel*: a channel that's about Minecraft
 * contributes everything it posted, so its one viral Valorant clip lands in the
 * breakout list with the highest multiplier of all. That's right for measuring a
 * niche and wrong for teaching a script — a writer shown five off-topic videos
 * writes from nothing, and the run that proved it opened on a Valorant clip at
 * 694x while writing about redstone.
 *
 * So sources are filtered here, on the video: it has to be about the topic, and
 * for a Shorts script it has to be a Short. Both filters step aside when they'd
 * leave too little to see a pattern in — a thin set of real outliers beats a
 * full set of unrelated ones, but an empty set beats neither.
 */

import { tokenize, topicAliases, type NicheMetrics } from "@/lib/niches/analysis";
import type { VideoFormat } from "@/types/database";

export type Breakout = NicheMetrics["breakouts"][number];

/** Below this, there's no pattern to take — better to widen than to show two videos. */
const MIN_PATTERN = 3;

export interface PickOptions {
  topic: string;
  /** What the Short is about. Its words break ties between equally on-topic outliers. */
  idea?: string;
  /** Shorts scripts learn from Shorts; long-form pacing teaches the wrong hook. */
  format?: VideoFormat;
  limit: number;
}

/** True when the video's own title is about the topic, not just its channel. */
export function isAboutTopic(title: string, topic: string): boolean {
  const wanted = new Set([...tokenize(topic), ...topicAliases(topic).flatMap(tokenize)]);
  // A topic that's all stopwords ("best videos") can't be checked, so nothing fails it.
  if (wanted.size === 0) return true;
  const words = new Set(tokenize(title));
  for (const word of wanted) if (words.has(word)) return true;
  return false;
}

/**
 * Best sources first, at most `limit`.
 *
 * Ranking is on-topic before in-format before multiplier, so a 5x Short about
 * the topic outranks a 700x video that isn't.
 */
export function pickScriptSources(breakouts: readonly Breakout[], options: PickOptions): Breakout[] {
  const ideaWords = new Set(tokenize(options.idea ?? ""));
  const scored = breakouts.map((breakout) => {
    const words = new Set(tokenize(breakout.title));
    let overlap = 0;
    for (const word of ideaWords) if (words.has(word)) overlap++;
    return {
      breakout,
      onTopic: isAboutTopic(breakout.title, options.topic),
      inFormat: options.format ? breakout.format === options.format : true,
      // Sharing words with the idea is a tie-breaker, never a reason to outrank relevance.
      overlap: Math.min(overlap, 3),
    };
  });

  // Drop a filter only when keeping it would leave too little to learn from.
  const onTopic = scored.filter((s) => s.onTopic);
  const pool = onTopic.length >= MIN_PATTERN ? onTopic : scored.length >= MIN_PATTERN ? scored : onTopic.length > 0 ? onTopic : scored;
  const inFormat = pool.filter((s) => s.inFormat);
  const narrowed = inFormat.length >= MIN_PATTERN ? inFormat : pool;

  return narrowed
    .sort(
      (a, b) =>
        Number(b.onTopic) - Number(a.onTopic) ||
        Number(b.inFormat) - Number(a.inFormat) ||
        b.overlap - a.overlap ||
        b.breakout.multiplier - a.breakout.multiplier,
    )
    .slice(0, options.limit)
    .map((s) => s.breakout);
}
