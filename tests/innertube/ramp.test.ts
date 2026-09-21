import { describe, expect, it } from "vitest";
import { clampState, decide, DEFAULT_RAMP_STEPS, initialState, parseSteps, type RampState } from "@/lib/innertube/ramp";

const STEPS = [4, 6, 9, 12];
const START = new Date("2026-09-20T00:00:00Z");
const later = (hours: number) => new Date(START.getTime() + hours * 3_600_000);

const state = (overrides: Partial<RampState> = {}): RampState => ({ ...initialState(START), ...overrides });
const run = (s: RampState, blocks: number, now: Date, cleanHours = 24) => decide(s, { blocks, now, steps: STEPS, cleanHours });

describe("parseSteps", () => {
  it.each([
    ["4,6,9", [4, 6, 9]],
    ["9, 4 ,6", [4, 6, 9]],
    ["4", [4]],
    ["4,4,6", [4, 6]],
    ["", DEFAULT_RAMP_STEPS],
    [undefined, DEFAULT_RAMP_STEPS],
    ["nonsense", DEFAULT_RAMP_STEPS],
    // Out of range values are dropped, not clamped.
    ["4,999,6", [4, 6]],
  ])("parses %s", (input, expected) => {
    expect(parseSteps(input)).toEqual(expected);
  });
});

describe("ramp", () => {
  it("holds the rate until the step has been clean long enough", () => {
    const decision = run(state(), 0, later(23));
    expect(decision).toMatchObject({ rate: 4, change: null });
  });

  it("steps up after a clean stretch", () => {
    const decision = run(state(), 0, later(24));
    expect(decision).toMatchObject({ rate: 6, change: "up" });
    expect(decision.state).toMatchObject({ step: 1, since: later(24).toISOString(), frozen: false });
  });

  it("climbs one rung at a time, restarting the clock at each step", () => {
    let current = state();
    const rates: number[] = [];
    for (let day = 1; day <= 5; day += 1) {
      const decision = run(current, 0, later(24 * day));
      current = decision.state;
      rates.push(decision.rate);
    }
    // Four rungs, then it sits at the top.
    expect(rates).toEqual([6, 9, 12, 12, 12]);
  });

  it("stops at the top of the ladder", () => {
    const decision = run(state({ step: 3 }), 0, later(48));
    expect(decision).toMatchObject({ rate: 12, change: null, reason: "at the top of the ladder" });
  });

  it("steps back down on a block and records the ceiling", () => {
    const decision = run(state({ step: 2 }), 1, later(30));
    expect(decision).toMatchObject({ rate: 6, change: "down" });
    expect(decision.state).toMatchObject({ step: 1, ceiling: 9, frozen: true });
    expect(decision.reason).toContain("9/min");
  });

  it("holds below the ceiling while the freeze is fresh", () => {
    const blocked = run(state({ step: 2 }), 1, later(30)).state;
    const decision = run(blocked, 0, later(30 + 12));
    expect(decision).toMatchObject({ rate: 6, change: null, reason: "holding below the ceiling" });
    expect(decision.state).toMatchObject({ step: 1, frozen: true });
  });

  it("thaws after a long clean stretch, but won't climb back into the ceiling", () => {
    const blocked = run(state({ step: 2 }), 1, later(30)).state;
    const thawed = run(blocked, 0, later(30 + 24 * 7));
    expect(thawed).toMatchObject({ rate: 6, change: null });
    expect(thawed.reason).toContain("thawed");
    expect(thawed.state).toMatchObject({ step: 1, frozen: false, ceiling: 9 });

    // Clean for another full step, but 9/min is the rate that was refused.
    const next = run(thawed.state, 0, later(30 + 24 * 8));
    expect(next).toMatchObject({ rate: 6, change: null, reason: "next step would reach the 9/min ceiling" });
  });

  it("treats a block at the bottom rung as unproven and climbs again once thawed", () => {
    // Nothing is slower than the first rung, so the refused rate was never
    // actually backed away from — the ladder must not be pinned there for good.
    const blocked = run(state({ step: 0 }), 1, later(2)).state;
    expect(blocked).toMatchObject({ step: 0, ceiling: 4, frozen: true });

    const thawed = run(blocked, 0, later(2 + 24 * 4)).state;
    expect(thawed.frozen).toBe(false);

    const next = run(thawed, 0, later(2 + 24 * 5));
    expect(next).toMatchObject({ rate: 6, change: "up" });
  });

  it("keeps stepping down if the lower rate is blocked too", () => {
    const first = run(state({ step: 2 }), 1, later(30)).state;
    const second = run(first, 1, later(31));
    expect(second.state).toMatchObject({ step: 0, ceiling: 6 });
    expect(second.rate).toBe(4);
  });

  it("never goes below the bottom rung", () => {
    const decision = run(state({ step: 0 }), 3, later(1));
    expect(decision).toMatchObject({ rate: 4, change: "down" });
    expect(decision.state.step).toBe(0);
  });

  it("survives a ladder that changed since the state was saved", () => {
    expect(clampState(state({ step: 9 }), STEPS, START).step).toBe(3);
    expect(clampState({ ...state(), since: "not a date" }, STEPS, START).since).toBe(START.toISOString());
    expect(clampState({ ...state(), step: -2 }, STEPS, START).step).toBe(0);
  });
});
