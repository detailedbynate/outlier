import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createLogger, type Logger } from "@/lib/core/logger";

/**
 * Finds the fastest scrape rate YouTube tolerates, by walking up a ladder of
 * rates and stepping back down when it pushes back.
 *
 * One clean period at a rate earns the next step up. A block gives back the
 * step and freezes the ladder there: the rate that got blocked becomes the
 * recorded ceiling, and the scraper settles one rung below it rather than
 * probing the same wall again. Clearing the state file (or `INNERTUBE_RAMP_STEPS`
 * changing) starts a fresh search.
 *
 * A freeze is a guess, not a verdict, so it thaws. After a long clean stretch
 * the ladder unfreezes and may climb again, stopping one rung below the
 * remembered ceiling. Two things made the original freeze too final: not every
 * refused read is really YouTube pushing back (a single odd channel page looks
 * identical to a consent wall), and a block at the bottom rung froze the
 * scraper at the very rate that had just failed — there is nothing below the
 * floor to back off to, so it stopped probing forever without ever slowing
 * down. A ceiling at the bottom rung is therefore treated as unproven.
 */

export interface RampState {
  /** Index into the ladder. */
  step: number;
  /** When the current step started, ISO. */
  since: string;
  /** The rate that got blocked, if one did. */
  ceiling: number | null;
  /** True once a block has been seen: no more stepping up until it thaws. */
  frozen: boolean;
  /** When the freeze started, ISO. Absent on states written before thawing existed. */
  frozenAt?: string | null;
}

/** A frozen ladder starts probing again after this long without a block. */
export const DEFAULT_THAW_HOURS = 72;

export interface RampDecision {
  state: RampState;
  rate: number;
  /** Set when the step changed, for the log line. */
  change: "up" | "down" | null;
  reason: string;
}

export const DEFAULT_RAMP_STEPS = [4, 6, 9, 12, 16, 20, 25];

export function initialState(now: Date): RampState {
  return { step: 0, since: now.toISOString(), ceiling: null, frozen: false, frozenAt: null };
}

/** Keep a loaded state usable when the ladder in the environment has changed since. */
export function clampState(state: RampState, steps: readonly number[], now: Date): RampState {
  const step = Number.isInteger(state.step) ? Math.min(Math.max(state.step, 0), steps.length - 1) : 0;
  const since = Number.isFinite(Date.parse(state.since)) ? state.since : now.toISOString();
  return { ...state, step, since };
}

/**
 * Decide the rate for the next round.
 *
 * `blocks` is how many times the circuit breaker tripped during the last round.
 */
export function decide(
  state: RampState,
  input: { blocks: number; now: Date; steps: readonly number[]; cleanHours: number; thawHours?: number },
): RampDecision {
  const { blocks, now, steps, cleanHours, thawHours = DEFAULT_THAW_HOURS } = input;
  const at = (step: number) => steps[Math.min(Math.max(step, 0), steps.length - 1)]!;
  const floor = steps[0]!;

  if (blocks > 0) {
    const blockedAt = at(state.step);
    const step = Math.max(state.step - 1, 0);
    return {
      state: { step, since: now.toISOString(), ceiling: blockedAt, frozen: true, frozenAt: now.toISOString() },
      rate: at(step),
      change: "down",
      reason: `YouTube pushed back at ${blockedAt}/min`,
    };
  }

  const held = now.getTime() - Date.parse(state.since);

  if (state.frozen) {
    // States written before thawing existed have no frozenAt; date the freeze
    // from the current step instead of leaving them frozen for good.
    const frozenSince = Date.parse(state.frozenAt ?? state.since);
    const frozenFor = Number.isFinite(frozenSince) ? now.getTime() - frozenSince : Infinity;
    if (frozenFor < thawHours * 3_600_000) {
      return { state, rate: at(state.step), change: null, reason: "holding below the ceiling" };
    }
    return {
      state: { ...state, frozen: false, frozenAt: null, since: now.toISOString() },
      rate: at(state.step),
      change: null,
      reason: `thawed after ${Math.round(frozenFor / 3_600_000)}h clean`,
    };
  }

  const top = state.step >= steps.length - 1;
  // A ceiling at the bottom rung never proved anything: the scraper could not
  // go slower, so the rate was never actually tested below what was refused.
  const wall = state.ceiling !== null && state.ceiling > floor ? state.ceiling : null;
  const blocked = wall !== null && at(state.step + 1) >= wall;
  if (top || blocked || held < cleanHours * 3_600_000) {
    return {
      state,
      rate: at(state.step),
      change: null,
      reason: top ? "at the top of the ladder" : blocked ? `next step would reach the ${wall}/min ceiling` : "waiting out the current step",
    };
  }

  const step = state.step + 1;
  return {
    state: { ...state, step, since: now.toISOString() },
    rate: at(step),
    change: "up",
    reason: `${Math.round(held / 3_600_000)}h clean at ${at(state.step)}/min`,
  };
}

export interface RampStore {
  read(): Promise<RampState | null>;
  write(state: RampState): Promise<void>;
}

/**
 * Keeps the ladder position in a file, so a restart or a deploy doesn't forget
 * what YouTube already told us. `INNERTUBE_STATE_DIR` or systemd's
 * `StateDirectory` decides where; a directory we can't write just means the
 * ladder restarts at the bottom next boot.
 */
export class FileRampStore implements RampStore {
  private readonly path: string;

  private readonly log: Logger;

  constructor(directory?: string, logger?: Logger) {
    const dir = directory ?? process.env.INNERTUBE_STATE_DIR ?? process.env.STATE_DIRECTORY ?? ".";
    this.path = join(dir, "scraper-ramp.json");
    this.log = logger ?? createLogger({ module: "innertube.ramp" });
  }

  async read(): Promise<RampState | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, "utf8"));
      if (parsed && typeof parsed === "object" && "step" in parsed) return parsed as RampState;
      return null;
    } catch {
      // No state yet, or unreadable: start at the bottom.
      return null;
    }
  }

  async write(state: RampState): Promise<void> {
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    } catch (error) {
      this.log.warn("could not save the scrape ramp state", { path: this.path, error });
    }
  }
}

/** Parse "4,6,9" into a sorted ladder of rates. */
export function parseSteps(value: string | undefined, fallback: readonly number[] = DEFAULT_RAMP_STEPS): number[] {
  const steps = (value ?? "")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((rate) => Number.isFinite(rate) && rate > 0 && rate <= 120);
  return steps.length > 0 ? [...new Set(steps)].sort((a, b) => a - b) : [...fallback];
}
