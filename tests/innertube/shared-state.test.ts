import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InnerTubeGate } from "@/lib/innertube/gate";
import { FileGateState } from "@/lib/innertube/shared-state";

/**
 * The point of sharing state is that two processes on one IP pace as one. Two
 * gates in one test stand in for the scraper and the web app.
 */
describe("shared gate state", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gate-shared-"));
    path = join(dir, "gate.json");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("hands consecutive slots to whoever asks, across separate holders", async () => {
    const now = 1_000_000;
    const a = new FileGateState(path, { now: () => now });
    const b = new FileGateState(path, { now: () => now });

    // 60/min is a slot a second, so two processes alternating should step.
    expect(await a.claim("background", 1_000)).toBe(now);
    expect(await b.claim("background", 1_000)).toBe(now + 1_000);
    expect(await a.claim("background", 1_000)).toBe(now + 2_000);
  });

  it("keeps the lanes on separate clocks", async () => {
    const now = 2_000_000;
    const state = new FileGateState(path, { now: () => now });
    await state.claim("background", 15_000);
    // A person waiting on a search must not queue behind the scraper's gap.
    expect(await state.claim("user", 2_000)).toBe(now);
  });

  it("pauses every gate when one of them is blocked", async () => {
    const shared = () => new FileGateState(path, { now: () => 3_000_000 });
    const hooks = { now: () => 3_000_000, sleep: async () => {}, random: () => 0.5 };
    const scraper = new InnerTubeGate({ breakerMs: 60_000 }, { ...hooks, shared: shared() });
    const web = new InnerTubeGate({ breakerMs: 60_000 }, { ...hooks, shared: shared() });

    expect(web.state().open).toBe(false);
    scraper.trip("sign in to confirm you're not a bot");
    // Written synchronously enough for the other gate's next read.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(web.state().open).toBe(true);
    await expect(web.run({ label: "search" }, async () => "never runs")).rejects.toThrow(/paused until/);
  });

  it("falls back to pacing itself when the file can't be used", async () => {
    const broken = new FileGateState(join(dir, "nope", "\0bad"), {});
    // A directory that can't be created must not stop the scrape.
    await expect(broken.claim("background", 1_000)).resolves.toBeTypeOf("object");
  });
});
