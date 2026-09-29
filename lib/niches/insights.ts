/**
 * The "why" behind a niche report: what its opportunity score is made of, how
 * uploads have moved week by week, and what the breakout uploads have in
 * common. Pure functions over the same sample the metrics come from.
 */

const DAY = 86_400_000;
const WEEK = 7 * DAY;

export type ScorePartKey = "demand" | "growth" | "viral" | "small" | "competition";

export interface ScorePart {
  key: ScorePartKey;
  /** 0 to 1: how well the niche does on this. */
  score: number;
  /** Share of the opportunity score this part carries (weights add to 1). */
  weight: number;
}

/** The opportunity score's weights, in one place so the score and its breakdown can't drift apart. */
export const SCORE_WEIGHTS: Record<ScorePartKey, number> = { demand: 0.3, growth: 0.2, viral: 0.2, small: 0.15, competition: 0.15 };

export interface WeekBucket {
  /** ISO date the week starts on. */
  weekStart: string;
  uploads: number;
  /** Median views of that week's uploads (0 with none). */
  medianViews: number;
}

export type TitleTraitKey = "number" | "question" | "caps" | "you" | "emoji";

export interface NichePatterns {
  /** How many breakouts the patterns come from. */
  breakouts: number;
  /** Title words much more common in breakouts than in the niche overall. */
  words: { word: string; breakouts: number; lift: number }[];
  /** Median words in a title. */
  titleLength: { breakout: number; all: number };
  /** Share of titles with each trait, breakouts against everything. */
  traits: { key: TitleTraitKey; breakout: number; all: number }[];
  /** By weekday (0 = Sunday, UTC): uploads, and the share of them that broke out. */
  days: { day: number; uploads: number; breakoutRate: number }[];
  /** Median length in seconds, when durations are stored. */
  length: { breakout: number | null; all: number | null };
}

interface PatternVideo {
  title: string;
  published_at: string;
  view_count: number;
  duration_seconds?: number | null;
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const round = (n: number, digits = 0) => Math.round(n * 10 ** digits) / 10 ** digits;

/** Weeks of uploads, oldest first, ending with the current week. */
export function weeklyUploads(videos: readonly PatternVideo[], now: Date, weeks = 10): WeekBucket[] {
  const buckets = Array.from({ length: weeks }, () => [] as number[]);
  for (const v of videos) {
    const index = Math.floor((now.getTime() - Date.parse(v.published_at)) / WEEK);
    if (index >= 0 && index < weeks) buckets[index]!.push(v.view_count);
  }
  return buckets
    .map((views, i) => ({
      weekStart: new Date(now.getTime() - (i + 1) * WEEK).toISOString().slice(0, 10),
      uploads: views.length,
      medianViews: Math.round(median(views)),
    }))
    .reverse();
}

const TRAITS: { key: TitleTraitKey; test: (title: string) => boolean }[] = [
  { key: "number", test: (t) => /\d/.test(t) },
  { key: "question", test: (t) => t.includes("?") },
  // A whole word in capitals, not an acronym: 4+ letters.
  { key: "caps", test: (t) => /\b[A-Z]{4,}\b/.test(t) },
  { key: "you", test: (t) => /\byou(r|'re|rself)?\b/i.test(t) },
  { key: "emoji", test: (t) => /\p{Extended_Pictographic}/u.test(t) },
];

/** Fewer breakouts than this and "patterns" would just be a few videos' quirks. */
const MIN_BREAKOUTS = 6;

/**
 * What breakout uploads share, next to the niche as a whole. `words` comes
 * from `tokenize`, passed in so this module doesn't depend on the analysis one.
 */
export function breakoutPatterns(
  all: readonly PatternVideo[],
  breakouts: readonly PatternVideo[],
  tokenize: (text: string) => string[],
): NichePatterns | undefined {
  if (breakouts.length < MIN_BREAKOUTS || all.length < breakouts.length * 2) return undefined;

  const wordsIn = (videos: readonly PatternVideo[]) => {
    const counts = new Map<string, number>();
    for (const v of videos) for (const w of new Set(tokenize(v.title))) counts.set(w, (counts.get(w) ?? 0) + 1);
    return counts;
  };
  const inBreakouts = wordsIn(breakouts);
  const inAll = wordsIn(all);
  // In at least 1 breakout title in 20: rarer than that is one channel's habit, not the niche's.
  const minHits = Math.max(3, Math.ceil(breakouts.length * 0.05));
  const words = [...inBreakouts.entries()]
    .filter(([, hits]) => hits >= minHits)
    .map(([word, hits]) => ({ word, breakouts: hits, lift: round(hits / breakouts.length / ((inAll.get(word) ?? hits) / all.length), 1) }))
    // Words in every title (the topic itself) have a lift near 1 and say nothing.
    .filter((w) => w.lift >= 1.3)
    .sort((a, b) => b.breakouts * b.lift - a.breakouts * a.lift)
    .slice(0, 8);

  const share = (videos: readonly PatternVideo[], test: (t: string) => boolean) => round(videos.filter((v) => test(v.title)).length / videos.length, 3);
  const traits = TRAITS.map(({ key, test }) => ({ key, breakout: share(breakouts, test), all: share(all, test) }));

  const wordCount = (t: string) => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const breakoutSet = new Set(breakouts);
  const days = Array.from({ length: 7 }, (_, day) => {
    const onDay = all.filter((v) => new Date(v.published_at).getUTCDay() === day);
    const hits = onDay.filter((v) => breakoutSet.has(v)).length;
    return { day, uploads: onDay.length, breakoutRate: onDay.length ? round(hits / onDay.length, 3) : 0 };
  });

  const durations = (videos: readonly PatternVideo[]) => videos.map((v) => v.duration_seconds).filter((d): d is number => typeof d === "number" && d > 0);
  const lengthOf = (videos: readonly PatternVideo[]) => {
    const found = durations(videos);
    // Too few stored durations to say anything.
    return found.length >= Math.max(5, videos.length * 0.4) ? Math.round(median(found)) : null;
  };

  return {
    breakouts: breakouts.length,
    words,
    titleLength: { breakout: median(breakouts.map((v) => wordCount(v.title))), all: median(all.map((v) => wordCount(v.title))) },
    traits,
    days,
    length: { breakout: lengthOf(breakouts), all: lengthOf(all) },
  };
}
