import type { GameStat } from "./games";

/**
 * The Niche Finder's track record. Every week it writes down its top games for
 * Shorts and long-form; a month later it looks at what small channels that
 * posted those games afterwards actually got. A pick is a hit when at least one
 * in five of those uploads pulled three times the channel's size, which is
 * roughly double a typical gaming upload's odds in the library.
 */

export const PICKS_PER_FORMAT = 5;
/** The window after a pick whose uploads are judged. */
export const PICK_WINDOW_DAYS = 30;
/** Extra days before judging, so the window's last uploads have had time to collect views. */
export const PICK_SETTLE_DAYS = 7;
export const HIT_BREAKOUT_RATE = 0.2;
/** Fewer small-channel uploads than this and there's nothing to judge. */
export const MIN_JUDGED_UPLOADS = 3;

export interface PickNumbers {
  medianViews: number;
  breakoutRate: number;
  channels: number;
  /** Small-channel uploads the breakout rate was taken over (outcomes only). */
  smallUploads?: number;
}

export interface NewPick {
  name: string;
  format: "shorts" | "long_form";
  score: number;
  baseline: PickNumbers;
}

export function choosePicks(games: readonly GameStat[], format: "shorts" | "long_form", count = PICKS_PER_FORMAT): NewPick[] {
  return games.slice(0, count).map((g) => ({
    name: g.game,
    format,
    score: g.score,
    baseline: { medianViews: g.medianViews, breakoutRate: g.breakoutRate, channels: g.channels },
  }));
}

/** What happened after a pick; null when too few small channels posted it to say. */
export function judgePick(after: GameStat | undefined): { outcome: PickNumbers; hit: boolean } | null {
  if (!after || after.smallUploads < MIN_JUDGED_UPLOADS) return null;
  return {
    outcome: { medianViews: after.medianViews, breakoutRate: after.breakoutRate, channels: after.channels, smallUploads: after.smallUploads },
    hit: after.breakoutRate >= HIT_BREAKOUT_RATE,
  };
}
