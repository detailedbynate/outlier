import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import type { GateLane } from "./gate";

/**
 * The rate budget and circuit breaker, shared between processes.
 *
 * The gate paces requests per process, which was fine while the scraper was the
 * only thing scraping. It isn't: discovery and live searches run in the web app,
 * the scraper runs in its own service, and YouTube sees one IP address. Three
 * gates each politely pacing to their own limit still add up to three times the
 * traffic, and the rate ladder — which only ever governed the scraper — was
 * tuning a third of what was actually going out.
 *
 * So the slot clock and the breaker live in one file that every process on the
 * box reads and writes. Claiming a slot is a read-modify-write under a lockfile;
 * the hold is a fraction of a millisecond and the contention is two or three
 * processes, so a spin with a short sleep is enough. If anything goes wrong with
 * the file the caller falls back to pacing itself, because scraping a little too
 * fast is better than a gate that throws.
 */

interface SharedFile {
  /** Earliest epoch ms the next request in each lane may run. */
  slots: Record<GateLane, number>;
  /** Epoch ms the breaker stays open until; 0 when closed. */
  openUntil: number;
  /** Consecutive trips, for the doubling pause. */
  trips: number;
}

const EMPTY: SharedFile = { slots: { background: 0, user: 0 }, openUntil: 0, trips: 0 };

/** Long enough for a stuck holder to be ignored, short enough not to stall a round. */
const LOCK_STALE_MS = 5_000;
const LOCK_RETRY_MS = 2;
const LOCK_ATTEMPTS = 250;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class FileGateState {
  private readonly lockPath: string;

  constructor(
    private readonly path: string,
    private readonly hooks: { now?: () => number; onError?: (error: unknown) => void } = {},
  ) {
    this.lockPath = `${path}.lock`;
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o775 });
    } catch (error) {
      this.hooks.onError?.(error);
    }
  }

  private now(): number {
    return this.hooks.now?.() ?? Date.now();
  }

  private read(): SharedFile {
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as Partial<SharedFile>;
      return {
        slots: {
          background: Number(raw.slots?.background) || 0,
          user: Number(raw.slots?.user) || 0,
        },
        openUntil: Number(raw.openUntil) || 0,
        trips: Number(raw.trips) || 0,
      };
    } catch {
      // Missing or corrupt: start clean rather than refusing to scrape.
      return { ...EMPTY, slots: { ...EMPTY.slots } };
    }
  }

  private write(state: SharedFile): void {
    // Written in place, not renamed: the file is shared between two users and
    // must keep the mode it was created with.
    writeFileSync(this.path, JSON.stringify(state), { mode: 0o664 });
  }

  /** Warned once, not per request: a read-only path would otherwise fill the log. */
  private warned = false;

  private warn(error: unknown): void {
    if (this.warned) return;
    this.warned = true;
    this.hooks.onError?.(error);
  }

  private async lock(): Promise<boolean> {
    for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
      try {
        const fd = openSync(this.lockPath, "wx", 0o664);
        // The timestamp is what makes a stale lock detectable, so it goes in
        // before the handle closes.
        try {
          writeSync(fd, String(this.now()));
        } finally {
          closeSync(fd);
        }
        return true;
      } catch {
        // A holder that died mid-write would block everyone forever.
        try {
          const age = this.now() - Number(readFileSync(this.lockPath, "utf8") || 0);
          if (age > LOCK_STALE_MS) unlinkSync(this.lockPath);
        } catch {
          // Someone else cleared it first.
        }
        await sleep(LOCK_RETRY_MS);
      }
    }
    return false;
  }

  private unlock(): void {
    try {
      unlinkSync(this.lockPath);
    } catch {
      // Already gone.
    }
  }

  /**
   * Take the next slot in `lane`, returning the epoch ms it may run at. Returns
   * null when the file can't be claimed, meaning the caller should pace itself.
   */
  async claim(lane: GateLane, gapMs: number): Promise<number | null> {
    if (!(await this.lock())) {
      this.warn(new Error(`could not claim ${this.path}: every process is pacing itself`));
      return null;
    }
    try {
      const state = this.read();
      const now = this.now();
      const slot = Math.max(now, state.slots[lane]);
      state.slots[lane] = slot + gapMs;
      this.write(state);
      return slot;
    } catch (error) {
      this.warn(error);
      return null;
    } finally {
      this.unlock();
    }
  }

  /** The breaker as every process sees it. Read without locking: a stale read only costs one request. */
  breaker(): { openUntil: number; trips: number } {
    const state = this.read();
    return { openUntil: state.openUntil, trips: state.trips };
  }

  /**
   * Record a block so every process backs off, not just the one that saw it.
   * The longest pause wins, because whoever tripped hardest knows most.
   */
  async trip(openUntil: number, trips: number): Promise<void> {
    if (!(await this.lock())) return;
    try {
      const state = this.read();
      this.write({ ...state, openUntil: Math.max(state.openUntil, openUntil), trips: Math.max(state.trips, trips) });
    } catch (error) {
      this.hooks.onError?.(error);
    } finally {
      this.unlock();
    }
  }
}
