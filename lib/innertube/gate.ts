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
  /** Requests per minute across the whole process. */
  requestsPerMinute: number;
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

  private readonly queue: Waiter[] = [];

  private readonly cache = new Map<string, CacheEntry>();

  private readonly inFlight = new Map<string, Promise<unknown>>();

  private running = 0;

  private nextSlot = 0;

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
  }

  state(): GateState {
    const open = this.openUntil > this.now();
    return {
      open,
      openUntil: open ? new Date(this.openUntil) : null,
      trips: this.trips,
      failuresInRow: this.failuresInRow,
      queued: this.queue.length,
      running: this.running,
    };
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
    const error = new InnerTubeBlockedError(reason, new Date(this.openUntil));
    this.log.warn("innertube paused", { reason, minutes: Math.round(pause / 60_000), trips: this.trips });
    // Anything still waiting would only run into the same wall.
    for (const waiter of this.queue.splice(0)) waiter.reject(new InnerTubeBlockedError(reason, new Date(this.openUntil)));
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
      await this.acquire();
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
    if (this.openUntil <= this.now()) return;
    this.stats.refused += 1;
    throw new InnerTubeBlockedError(`paused until ${new Date(this.openUntil).toISOString()} (${label})`, new Date(this.openUntil));
  }

  private backoff(attempt: number): number {
    const base = Math.min(this.options.minBackoffMs * 2 ** (attempt - 1), this.options.maxBackoffMs);
    return Math.round(base * (0.8 + this.random() * 0.4));
  }

  /** Take a concurrency slot, then wait for this request's turn in the rate limit. */
  private async acquire(): Promise<void> {
    if (this.running >= this.options.maxConcurrent) {
      await new Promise<void>((resolve, reject) => this.queue.push({ resolve, reject }));
    }
    this.running += 1;
    const gap = 60_000 / this.options.requestsPerMinute;
    const now = this.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + gap;
    if (slot > now) await this.sleep(slot - now);
  }

  private release(): void {
    this.running -= 1;
    this.queue.shift()?.resolve();
  }
}

let gate: InnerTubeGate | null = null;

/** The process-wide gate. Every InnerTube read shares it. */
export function getInnerTubeGate(options?: Partial<InnerTubeGateOptions>): InnerTubeGate {
  gate ??= new InnerTubeGate(options);
  return gate;
}

/** Tests only: drop the shared gate. */
export function resetInnerTubeGate(): void {
  gate = null;
}
