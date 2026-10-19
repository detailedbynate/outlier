import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createLogger, type Logger } from "@/lib/core/logger";

/**
 * When the scraper last started each of its occasional heavy jobs, kept in a
 * file beside the ramp state so a restart doesn't make them due again.
 *
 * Held in memory only, "once a day" meant once per process. Working out the
 * library's niche boards reads two 40K-upload samples, more than the scraper's
 * heap holds, so every fresh process ran it, died of it and restarted: a crash
 * loop that also kept any round from finishing, so the rate ladder never moved.
 *
 * A job is marked when it starts, not when it ends. One that takes the process
 * down then waits out its interval like any other run, instead of being retried
 * on every restart.
 */
export class FileDailyMarks {
  private readonly path: string;

  private readonly log: Logger;

  /** What's on disk, plus marks that couldn't be saved: those still hold for this process. */
  private marks: Record<string, string> | null = null;

  constructor(directory?: string, logger?: Logger) {
    const dir = directory ?? process.env.INNERTUBE_STATE_DIR ?? process.env.STATE_DIRECTORY ?? ".";
    this.path = join(dir, "scraper-daily.json");
    this.log = logger ?? createLogger({ module: "innertube.daily" });
  }

  /** True, and marked as started now, when `job` last started at least `everyMs` ago or never has. */
  async claim(job: string, everyMs: number, now: Date = new Date()): Promise<boolean> {
    const marks = await this.load();
    const last = Date.parse(marks[job] ?? "");
    // A mark from the future (a clock that jumped back) counts as stale rather than blocking for good.
    if (Number.isFinite(last) && last <= now.getTime() && now.getTime() - last < everyMs) return false;
    marks[job] = now.toISOString();
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path, `${JSON.stringify(marks, null, 2)}\n`, "utf8");
    } catch (error) {
      this.log.warn("could not save when the scraper's daily jobs ran", { path: this.path, error });
    }
    return true;
  }

  private async load(): Promise<Record<string, string>> {
    if (this.marks) return this.marks;
    let marks: Record<string, string> = {};
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        marks = Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
      }
    } catch {
      // Nothing saved yet, or unreadable: every job is due.
    }
    this.marks = marks;
    return marks;
  }
}
