import { median } from "./metrics";

/**
 * What tends to work on one channel, read from its own recent uploads: which
 * format, Short length, posting day and title habits beat its usual. Plain
 * comparisons of medians, only reported when there are enough videos on both
 * sides and the gap is big enough to matter.
 */

export interface PatternVideo {
  title: string;
  format: string;
  duration_seconds: number | null;
  published_at: string;
  view_count: number;
  outlier_score: number | null;
}

export interface ChannelPattern {
  /** Stable key, for React and tests. */
  key: string;
  title: string;
  detail: string;
  /** How much better (or worse, below 1) the pattern does than the rest; for ordering. */
  lift: number;
}

const MIN_SIDE = 3;
const MIN_LIFT = 1.25;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const LENGTHS = [
  { label: "under 20 seconds", test: (s: number) => s < 20 },
  { label: "20 to 40 seconds", test: (s: number) => s >= 20 && s < 40 },
  { label: "40 to 60 seconds", test: (s: number) => s >= 40 && s <= 60 },
  { label: "over a minute", test: (s: number) => s > 60 },
] as const;

const TITLE_HABITS: { key: string; name: string; test: (title: string) => boolean }[] = [
  { key: "question", name: "ask a question", test: (t) => t.includes("?") },
  { key: "number", name: "have a number in them", test: (t) => /\d/.test(t) },
  { key: "caps", name: "shout a word in CAPS", test: (t) => /\b[A-Z]{3,}\b/.test(t.replace(/#\S+/g, "")) },
  { key: "ellipsis", name: "trail off with “…”", test: (t) => /(\.\.\.|…)\s*(#\S+\s*)*$/.test(t.trim()) },
];

const x = (n: number) => `${n >= 10 ? Math.round(n) : n.toFixed(1)}×`;

function compare(key: string, title: string, inGroup: number[], rest: number[], describe: (a: number, b: number) => string): ChannelPattern | null {
  if (inGroup.length < MIN_SIDE || rest.length < MIN_SIDE) return null;
  const a = median(inGroup);
  const b = median(rest);
  if (a === null || b === null || b <= 0) return null;
  const lift = a / b;
  if (lift < MIN_LIFT && lift > 1 / MIN_LIFT) return null;
  return { key, title, detail: describe(a, b), lift };
}

export function channelPatterns(videos: readonly PatternVideo[]): ChannelPattern[] {
  const scored = videos.filter((v): v is PatternVideo & { outlier_score: number } => v.outlier_score !== null && v.outlier_score >= 0);
  const out: (ChannelPattern | null)[] = [];

  // Shorts or long videos.
  const shorts = scored.filter((v) => v.format === "short");
  const longs = scored.filter((v) => v.format === "long_form");
  if (shorts.length >= MIN_SIDE && longs.length >= MIN_SIDE) {
    const s = median(shorts.map((v) => v.view_count))!;
    const l = median(longs.map((v) => v.view_count))!;
    const better = s >= l ? "Shorts" : "Long videos";
    const lift = Math.max(s, l) / Math.max(Math.min(s, l), 1);
    if (lift >= MIN_LIFT)
      out.push({
        key: "format",
        title: `${better} pull more views here`,
        detail: `A typical Short gets ${compact(s)} views and a typical video ${compact(l)}.`,
        lift,
      });
  }

  // How long its best Shorts run.
  const timed = shorts.filter((v) => v.duration_seconds !== null && v.duration_seconds > 0);
  if (timed.length >= 8) {
    const buckets = LENGTHS.map((b) => ({ ...b, in: timed.filter((v) => b.test(v.duration_seconds!)) })).filter((b) => b.in.length >= MIN_SIDE);
    const best = buckets
      .map((b) => ({ ...b, score: median(b.in.map((v) => v.outlier_score))! }))
      .toSorted((a, b) => b.score - a.score)[0];
    if (best) {
      const rest = timed.filter((v) => !best.test(v.duration_seconds!)).map((v) => v.outlier_score);
      out.push(
        compare(
          "length",
          `Shorts ${best.label} do best`,
          best.in.map((v) => v.outlier_score),
          rest,
          (a, b) => `They land at ${x(a)} the channel's usual against ${x(b)} for the rest (${best.in.length} Shorts).`,
        ),
      );
    }
  }

  // Which day uploads land best (UTC).
  if (scored.length >= 10) {
    const byDay = DAYS.map((name, day) => ({ name, in: scored.filter((v) => new Date(v.published_at).getUTCDay() === day) })).filter((d) => d.in.length >= 2);
    const best = byDay.map((d) => ({ ...d, score: median(d.in.map((v) => v.outlier_score))! })).toSorted((a, b) => b.score - a.score)[0];
    if (best) {
      const inDay = best.in.map((v) => v.outlier_score);
      const rest = scored.filter((v) => !best.in.includes(v)).map((v) => v.outlier_score);
      const found = inDay.length >= 2 && rest.length >= MIN_SIDE ? median(inDay)! / Math.max(median(rest)!, 0.0001) : 0;
      if (found >= MIN_LIFT)
        out.push({
          key: "day",
          title: `${best.name} uploads land best`,
          detail: `${x(median(inDay)!)} the usual against ${x(median(rest)!)} on other days (${inDay.length} uploads, UTC).`,
          lift: found,
        });
    }
  }

  // Title habits.
  for (const habit of TITLE_HABITS) {
    const withIt = scored.filter((v) => habit.test(v.title));
    const without = scored.filter((v) => !habit.test(v.title));
    out.push(
      compare(
        `title-${habit.key}`,
        `Titles that ${habit.name} ${(median(withIt.map((v) => v.outlier_score)) ?? 0) >= (median(without.map((v) => v.outlier_score)) ?? 0) ? "do better" : "do worse"}`,
        withIt.map((v) => v.outlier_score),
        without.map((v) => v.outlier_score),
        (a, b) => `${x(a)} the usual against ${x(b)} without (${withIt.length} of ${scored.length} uploads).`,
      ),
    );
  }

  return out
    .filter((p): p is ChannelPattern => p !== null)
    .toSorted((a, b) => Math.max(b.lift, 1 / b.lift) - Math.max(a.lift, 1 / a.lift))
    .slice(0, 4);
}

/** How many of these uploads at least doubled the channel's usual views. */
export function hitRate(videos: readonly PatternVideo[]): { hits: number; of: number } {
  const scored = videos.filter((v) => v.outlier_score !== null);
  return { hits: scored.filter((v) => v.outlier_score! >= 2).length, of: scored.length };
}

function compact(n: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}
