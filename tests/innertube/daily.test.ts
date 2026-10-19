import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "@/lib/core/logger";
import { FileDailyMarks } from "@/lib/innertube/daily";

const DAY = 86_400_000;
const START = new Date("2026-10-19T00:00:00Z");
const later = (hours: number) => new Date(START.getTime() + hours * 3_600_000);

describe("FileDailyMarks", () => {
  let dir: string;
  const marks = () => new FileDailyMarks(dir, createLogger({ module: "test" }));

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "daily-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("runs a job the first time, then not again until its interval is up", async () => {
    const store = marks();
    expect(await store.claim("library-seeds", DAY, START)).toBe(true);
    expect(await store.claim("library-seeds", DAY, later(23))).toBe(false);
    expect(await store.claim("library-seeds", DAY, later(24))).toBe(true);
  });

  it("remembers across restarts, so a crash loop can't make the job due every boot", async () => {
    // The scraper used to keep this in memory: every restart ran the heavy daily
    // job again, the job ran it out of memory, and it restarted.
    expect(await marks().claim("library-seeds", DAY, START)).toBe(true);
    expect(await marks().claim("library-seeds", DAY, later(0.1))).toBe(false);
    expect(await marks().claim("library-seeds", DAY, later(5))).toBe(false);
  });

  it("keeps each job's mark apart", async () => {
    const store = marks();
    expect(await store.claim("library-seeds", DAY, START)).toBe(true);
    expect(await store.claim("niche-picks", DAY, START)).toBe(true);
    const saved = JSON.parse(await readFile(join(dir, "scraper-daily.json"), "utf8"));
    expect(Object.keys(saved).sort()).toEqual(["library-seeds", "niche-picks"]);
  });

  it("treats an unreadable file or a mark from the future as due", async () => {
    await writeFile(join(dir, "scraper-daily.json"), "not json", "utf8");
    expect(await marks().claim("library-seeds", DAY, START)).toBe(true);

    await writeFile(join(dir, "scraper-daily.json"), JSON.stringify({ "library-seeds": later(48).toISOString() }), "utf8");
    expect(await marks().claim("library-seeds", DAY, START)).toBe(true);
  });

  it("still holds within the process when the mark can't be saved", async () => {
    // A path under a file can't be a directory: every write fails.
    await writeFile(join(dir, "blocker"), "", "utf8");
    const store = new FileDailyMarks(join(dir, "blocker", "state"), createLogger({ module: "test" }));
    expect(await store.claim("library-seeds", DAY, START)).toBe(true);
    expect(await store.claim("library-seeds", DAY, later(1))).toBe(false);
  });
});
