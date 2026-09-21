import { AppError, isAppError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";

/**
 * The one way into YouTube's web endpoints (InnerTube). Every request in the
 * process — whoever asks, whatever endpoint — goes through this gate, so the
 * rate limit is a property of the application and not of a user, a route, or a
 * scraper instance.
 *
 * In order, a request:
 *   1. is served from the in-memory cache, or joins an identical in-flight read;
 *   2. is refused outright while the circuit breaker is open;
 *   3. waits in one FIFO queue, bounded by concurrency and a minimum gap;
 *   4. retries transient failures with exponential backoff and jitter;
 *   5. trips the breaker on a block, or on enough failures in a row.
 *
 * The breaker's cooldown doubles each time it reopens without a good read in
 * between, so a persistent block backs further off instead of poking YouTube.
 */

/**
 * The gate is busy and this read isn't willing to wait (a user is watching).
 * Not a sign of trouble: the caller falls back to the official API.
 */
export class InnerTubeBusyError extends AppError {
  constructor(waitMs: number) {
    super("RATE_LIMITED", `InnerTube busy: next slot is ${Math.round(waitMs)}ms away`, { expose: false, retryable: true });
    this.name = "InnerTubeBusyError";
  }
}

/** YouTube answered with a bot check or a rate limit, or the breaker is open. Back off; don't retry now. */
export class InnerTubeBlockedError extends AppError {
  readonly retryAt: Date;

  constructor(reason: string, retryAt: Date = new Date()) {
    super("RATE_LIMITED", `InnerTube blocked: ${reason}`, { expose: false, retryable: true });
    this.name = "InnerTubeBlockedError";
    this.retryAt = retryAt;
  }
}

export interface InnerTubeGateOptions {
  /** Background requests per minute across the whole process (the scraper's pace). */
  requestsPerMinute: number;
  /**
   * Requests per minute for the "user" lane, on top of the background rate. A
   * person waiting on a page must not queue behind bulk scraping, so interactive
   * reads get their own allowance; everything else about them is shared, including
   * the cache, the failure counters, and the circuit breaker.
   */
  userRequestsPerMinute: number;
  /** Requests in flight at once. */
  maxConcurrent: number;
  /** Retries per request after a transient failure. */
  maxRetries: number;
  /** First retry delay; doubles per attempt, capped at `maxBackoffMs`, ±20% jitter. */
  minBackoffMs: number;
  maxBackoffMs: number;
  /** Failures in a row (across all callers) that trip the breaker. */
  failureThreshold: number;
  /** How long the breaker stays open the first time; doubles up to `maxBreakerMs`. */
  breakerMs: number;
  maxBreakerMs: number;
  /** How long cached reads stay fresh. 0 disables the cache. */
  cacheTtlMs: number;
  /** Cache entries kept (oldest dropped first). */
  maxCacheEntries: number;
}

export const INNERTUBE_GATE_DEFAULTS: InnerTubeGateOptions = {
  requestsPerMinute: 4,
  userRequestsPerMinute: 12,
  maxConcurrent: 1,
  maxRetries: 2,
  minBackoffMs: 5_000,
  maxBackoffMs: 120_000,
  failureThreshold: 5,
  breakerMs: 30 * 60_000,
  maxBreakerMs: 12 * 3_600_000,
  cacheTtlMs: 30 * 60_000,
  maxCacheEntries: 500,
};

export interface GateState {
  /** True while the breaker refuses requests. */
  open: boolean;
  openUntil: Date | null;
  /** Consecutive times the breaker has opened without a good read in between. */
  trips: number;
  failuresInRow: number;
  queued: number;
  running: number;
}

export type GateLane = "background" | "user";

export interface GateStats {
  requests: number;
  cacheHits: number;
  retries: number;
  failures: number;
  blocks: number;
  /** Requests refused because the breaker was open. */
  refused: number;
}

export interface GateHooks {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  logger?: Logger;
  /**
   * Rate budget and breaker shared with the other processes on this machine.
   * Without one the gate paces only itself, which understates what YouTube
   * actually sees when the scraper and the web app both scrape.
   */
  shared?: SharedGateState;
}

/** The slice of {@link FileGateState} the gate needs. */
export interface SharedGateState {
  claim(lane: GateLane, gapMs: number): Promise<number | null>;
  breaker(): { openUntil: number; trips: number };
  trip(openUntil: number, trips: number): Promise<void>;
}

/** Errors that mean YouTube is pushing back rather than something being broken. */
const BLOCK_PATTERN = /sign in to confirm|not a bot|captcha|unusual traffic|rate.?limit|too many requests|\b(429|403)\b|quota/i;

export function looksLikeBlock(error: unknown): boolean {
  if (error instanceof InnerTubeBlockedError) return true;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return BLOCK_PATTERN.test(message);
}

interface Waiter {
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

export interface RunOptions {
  /** What this read is, for logs. */
  label: string;
  /** "user" jumps the queue and uses the interactive allowance. Defaults to "background". */
  lane?: GateLane;
  /**
   * Give up instead of waiting longer than this for a slot (throws
   * InnerTubeBusyError). Interactive reads set it so a person never waits on the
   * scraper's pace.
   */
  maxWaitMs?: number;
  /** Identical keys share one in-flight request and one cache entry. Omit to skip the cache. */
  cacheKey?: string;
  cacheTtlMs?: number;
}

export class InnerTubeGate {
  private readonly options: InnerTubeGateOptions;


  private readonly log: Logger;

  private readonly now: () => number;

  private readonly sleep: (ms: number) => Promise<void>;

  private readonly random: () => number;

  private readonly shared?: SharedGateState;

  /** Two queues, one limiter: user reads are served before background ones. */
  private readonly queues: Record<GateLane, Waiter[]> = { user: [], background: [] };

  private readonly cache = new Map<string, CacheEntry>();

  private readonly inFlight = new Map<string, Promise<unknown>>();

  private running = 0;

  private readonly nextSlot: Record<GateLane, number> = { user: 0, background: 0 };

  private failuresInRow = 0;

  private trips = 0;

  private openUntil = 0;

  private stats: GateStats = { requests: 0, cacheHits: 0, retries: 0, failures: 0, blocks: 0, refused: 0 };

  constructor(options: Partial<InnerTubeGateOptions> = {}, hooks: GateHooks = {}) {
    this.options = { ...INNERTUBE_GATE_DEFAULTS, ...options };
    this.log = hooks.logger ?? createLogger({ module: "innertube.gate" });
    this.now = hooks.now ?? Date.now;
    this.sleep = hooks.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = hooks.random ?? Math.random;
    this.shared = hooks.shared;
  }

  /** The later of this process's pause and any other process's. */
  private pausedUntil(): number {
    if (!this.shared) return this.openUntil;
    try {
      return Math.max(this.openUntil, this.shared.breaker().openUntil);
    } catch {
      return this.openUntil;
    }
  }

  state(): GateState {
    const open = this.pausedUntil() > this.now();
    return {
      open,
      openUntil: open ? new Date(this.pausedUntil()) : null,
      trips: this.trips,
      failuresInRow: this.failuresInRow,
      queued: this.queues.user.length + this.queues.background.length,
      running: this.running,
    };
  }

  /** Requests per minute the gate is currently pacing to. */
  get requestsPerMinute(): number {
    return this.options.requestsPerMinute;
  }

  /** Change the global rate. Requests already waiting keep the gap they were given. */
  setRequestsPerMinute(perMinute: number): void {
    if (!(perMinute > 0)) throw new Error(`requestsPerMinute must be positive, got ${perMinute}`);
    this.options.requestsPerMinute = perMinute;
  }

  takeStats(): GateStats {
    const stats = this.stats;
    this.stats = { requests: 0, cacheHits: 0, retries: 0, failures: 0, blocks: 0, refused: 0 };
    return stats;
  }

  /** Open the breaker now, e.g. because a caller saw a block in a response body. */
  trip(reason: string): InnerTubeBlockedError {
    this.trips += 1;
    this.failuresInRow = 0;
    this.stats.blocks += 1;
    const pause = Math.min(this.options.breakerMs * 2 ** (this.trips - 1), this.options.maxBreakerMs);
    this.openUntil = this.now() + pause;
    void this.shared?.trip(this.openUntil, this.trips);
    const error = new InnerTubeBlockedError(reason, new Date(this.openUntil));
    this.log.warn("innertube paused", { reason, minutes: Math.round(pause / 60_000), trips: this.trips });
    // Anything still waiting would only run into the same wall.
    for (const lane of ["user", "background"] as const) {
      for (const waiter of this.queues[lane].splice(0)) waiter.reject(new InnerTubeBlockedError(reason, new Date(this.openUntil)));
    }
    return error;
  }

  /** Run a read through cache, queue, limiter, retries, and breaker. */
  async run<T>(options: RunOptions, fn: () => Promise<T>): Promise<T> {
    const { cacheKey } = options;
    if (cacheKey) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > this.now()) {
        this.stats.cacheHits += 1;
        return cached.value as T;
      }
      if (cached) this.cache.delete(cacheKey);
      const shared = this.inFlight.get(cacheKey);
      if (shared) {
        this.stats.cacheHits += 1;
        return shared as Promise<T>;
      }
    }

    const attempt = this.attempts(options, fn);
    if (!cacheKey) return attempt;

    this.inFlight.set(cacheKey, attempt);
    try {
      const value = await attempt;
      this.remember(cacheKey, value, options.cacheTtlMs);
      return value;
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  private remember(key: string, value: unknown, ttlMs = this.options.cacheTtlMs): void {
    if (ttlMs <= 0 || this.options.maxCacheEntries <= 0) return;
    this.cache.delete(key);
    this.cache.set(key, { value, expiresAt: this.now() + ttlMs });
    // Map keeps insertion order, so the first key is the oldest write.
    while (this.cache.size > this.options.maxCacheEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  private async attempts<T>(options: RunOptions, fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      this.assertClosed(options.label);
      await this.acquire(options.lane ?? "background", options.maxWaitMs);
      this.stats.requests += 1;
      let retryIn: number;
      try {
        const value = await fn();
        this.failuresInRow = 0;
        // A good read means the last block is over, so the next one starts from the shortest pause.
        this.trips = 0;
        return value;
      } catch (error) {
        if (looksLikeBlock(error)) throw this.trip(error instanceof Error ? error.message.slice(0, 200) : String(error));
        // A definite answer (e.g. the channel doesn't exist) is not YouTube pushing back: don't retry, don't count it.
        if (isAppError(error) && !error.retryable) throw error;

        this.stats.failures += 1;
        this.failuresInRow += 1;
        // Enough failures in a row is itself a signal that YouTube stopped answering us.
        if (this.failuresInRow >= this.options.failureThreshold) throw this.trip(`${this.failuresInRow} failed reads in a row`);
        if (attempt > this.options.maxRetries) throw error;

        this.stats.retries += 1;
        retryIn = this.backoff(attempt);
        this.log.warn("innertube read failed, retrying", { label: options.label, attempt, delayMs: retryIn, error });
      } finally {
        // Freed before the retry wait, so a backing-off request doesn't hold the queue.
        this.release();
      }
      await this.sleep(retryIn);
    }
  }

  private assertClosed(label: string): void {
    // A block another process saw counts: the IP is what YouTube refused, not
    // the process.
    const until = this.pausedUntil();
    if (until <= this.now()) return;
    this.stats.refused += 1;
    throw new InnerTubeBlockedError(`paused until ${new Date(until).toISOString()} (${label})`, new Date(until));
  }

  private backoff(attempt: number): number {
    const base = Math.min(this.options.minBackoffMs * 2 ** (attempt - 1), this.options.maxBackoffMs);
    return Math.round(base * (0.8 + this.random() * 0.4));
  }

  /** Take a concurrency slot, then wait for this request's turn in its lane's rate limit. */
  private async acquire(lane: GateLane, maxWaitMs?: number): Promise<void> {
    const gap = 60_000 / (lane === "user" ? this.options.userRequestsPerMinute : this.options.requestsPerMinute);
    // Refuse before queueing if this read isn't willing to wait for its turn.
    if (maxWaitMs !== undefined) {
      const wait = Math.max(this.nextSlot[lane] - this.now(), 0);
      if (wait > maxWaitMs) throw new InnerTubeBusyError(wait);
    }
    if (this.running >= this.options.maxConcurrent) {
      await new Promise<void>((resolve, reject) => this.queues[lane].push({ resolve, reject }));
    }
    this.running += 1;
    const now = this.now();
    // The shared clock is the real one when every process shares an IP; the
    // local one still advances so maxWaitMs has something to judge, and so a
    // file that can't be claimed falls back to pacing this process alone.
    const shared = this.shared ? await this.shared.claim(lane, gap) : null;
    const slot = shared ?? Math.max(now, this.nextSlot[lane]);
    this.nextSlot[lane] = Math.max(slot, this.nextSlot[lane]) + gap;
    const waitUntil = this.now();
    if (slot > waitUntil) await this.sleep(slot - waitUntil);
  }

  private release(): void {
    this.running -= 1;
    // User reads first.
    (this.queues.user.shift() ?? this.queues.background.shift())?.resolve();
  }
}

let gate: InnerTubeGate | null = null;

/** The process-wide gate. Every InnerTube read shares it. */
export function getInnerTubeGate(options?: Partial<InnerTubeGateOptions>, shared?: SharedGateState): InnerTubeGate {
  gate ??= new InnerTubeGate(options, { shared });
  return gate;
}

/** Tests only: drop the shared gate. */
export function resetInnerTubeGate(): void {
  gate = null;
}
