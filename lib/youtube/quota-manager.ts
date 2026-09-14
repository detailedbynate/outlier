import { AppError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { QuotaLane } from "@/types/database";
import type { QuotaContext } from "./quota-context";

/**
 * Daily YouTube quota budgeting. Every API request asks `acquire` first; the
 * store records usage atomically by day, lane, operation, and user.
 *
 * Budget layout for a day of `dailyUnits`:
 *   - `safetyBufferUnits` is never spent (absorbs retries and clock skew).
 *   - Background work may use at most `dailyUnits - userReserveUnits - safetyBufferUnits`,
 *     so jobs can never starve user-triggered requests.
 *   - User requests may use anything left under the buffer, capped per user by tier.
 */

export interface QuotaTier {
  /** Units one user may spend per quota day. */
  userDailyUnits: number;
}

export interface QuotaConfig {
  dailyUnits: number;
  userReserveUnits: number;
  safetyBufferUnits: number;
  /** Tier name -> limits. "default" is required and used for unknown tiers. */
  tiers: Record<string, QuotaTier> & { default: QuotaTier };
}

export interface QuotaRequest {
  units: number;
  endpoint: string;
}

export interface QuotaStore {
  consume(input: {
    day: string;
    lane: QuotaLane;
    operation: string;
    userKey: string;
    units: number;
    totalLimit: number;
    laneLimit: number;
    userLimit: number | null;
  }): Promise<boolean>;
  usage(day: string): Promise<{ lane: QuotaLane; operation: string; userKey: string; units: number; requests: number; denied: number }[]>;
}

export interface QuotaSummary {
  day: string;
  resetsAt: string;
  limits: { daily: number; background: number; user: number };
  used: { total: number; background: number; user: number };
  denied: number;
  byOperation: { operation: string; lane: QuotaLane; units: number; requests: number; denied: number }[];
}

/** Thrown when a request can't be served within quota. Retryable: the job runner reschedules to `retryAt`. */
export class QuotaUnavailableError extends AppError {
  readonly retryAt: Date;
  readonly lane: QuotaLane;

  constructor(lane: QuotaLane, retryAt: Date, reason: "daily" | "lane" | "user") {
    const message =
      reason === "user"
        ? "You've reached today's YouTube data limit. It resets at midnight Pacific."
        : "YouTube data is temporarily unavailable (daily limit reached). Try again later.";
    super("QUOTA_EXCEEDED", message, { retryable: true, expose: true, details: { lane, reason, retryAt: retryAt.toISOString() } });
    this.retryAt = retryAt;
    this.lane = lane;
  }
}

export function isQuotaUnavailable(error: unknown): error is QuotaUnavailableError {
  return error instanceof QuotaUnavailableError;
}

const PACIFIC = "America/Los_Angeles";

/** YouTube quota day (resets at midnight Pacific), as YYYY-MM-DD. */
export function quotaDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PACIFIC, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Next Pacific midnight after `now` (DST-safe: probes forward for the day change). */
export function nextQuotaReset(now: Date = new Date()): Date {
  const today = quotaDay(now);
  let low = now.getTime();
  let high = now.getTime() + 26 * 3_600_000;
  while (high - low > 60_000) {
    const mid = Math.floor((low + high) / 2);
    if (quotaDay(new Date(mid)) === today) low = mid;
    else high = mid;
  }
  // The boundary lies in (low, high] and high - low <= 1 minute, so flooring to the minute lands on it.
  return new Date(Math.floor(high / 60_000) * 60_000);
}

export class QuotaManager {
  private readonly log: Logger;

  constructor(
    private readonly store: QuotaStore,
    private readonly config: QuotaConfig,
    logger?: Logger,
    /** Per-user overrides: `dailyUnits` undefined = tier default, null = no per-user cap. */
    private readonly userLimits?: (userId: string) => Promise<{ dailyUnits?: number | null; tier?: string } | null>,
  ) {
    this.log = logger ?? createLogger({ module: "youtube.quota" });
    if (config.userReserveUnits + config.safetyBufferUnits >= config.dailyUnits) {
      throw new AppError("CONFIG_ERROR", "YouTube quota reserve and buffer must be smaller than the daily quota", { expose: false });
    }
  }

  limits(tier = "default"): { total: number; background: number; user: number; perUser: number } {
    const total = this.config.dailyUnits - this.config.safetyBufferUnits;
    return {
      total,
      background: total - this.config.userReserveUnits,
      user: total,
      perUser: (this.config.tiers[tier] ?? this.config.tiers.default).userDailyUnits,
    };
  }

  /** Reserve units for one request or throw QuotaUnavailableError. */
  async acquire(request: QuotaRequest, context: QuotaContext, now: Date = new Date()): Promise<void> {
    const userKey = context.lane === "user" && context.userId ? context.userId : "";
    const override = userKey ? await this.userOverride(userKey) : null;
    const limits = this.limits(override?.tier ?? context.tier);
    const perUser = override?.dailyUnits === undefined ? limits.perUser : override.dailyUnits;
    let allowed: boolean;
    try {
      allowed = await this.store.consume({
        day: quotaDay(now),
        lane: context.lane,
        operation: context.operation,
        userKey,
        units: request.units,
        totalLimit: limits.total,
        laneLimit: context.lane === "background" ? limits.background : limits.user,
        userLimit: userKey ? perUser : null,
      });
    } catch (error) {
      // If the ledger itself is unreachable, fail open (YouTube still enforces the hard limit) and alert.
      this.log.error("youtube quota ledger unavailable", { error, endpoint: request.endpoint });
      return;
    }
    if (allowed) return;

    const reason = await this.denialReason(context, userKey, request.units, now);
    this.log.warn("youtube quota denied", { lane: context.lane, operation: context.operation, endpoint: request.endpoint, units: request.units, reason });
    throw new QuotaUnavailableError(context.lane, nextQuotaReset(now), reason);
  }

  async summary(now: Date = new Date()): Promise<QuotaSummary> {
    const day = quotaDay(now);
    const rows = await this.store.usage(day);
    const limits = this.limits();
    const sum = (filter: (r: (typeof rows)[number]) => boolean, field: "units" | "denied" = "units") =>
      rows.filter(filter).reduce((acc, r) => acc + r[field], 0);
    const byOperation = new Map<string, QuotaSummary["byOperation"][number]>();
    for (const row of rows) {
      const key = `${row.lane}:${row.operation}`;
      const entry = byOperation.get(key) ?? { operation: row.operation, lane: row.lane, units: 0, requests: 0, denied: 0 };
      entry.units += row.units;
      entry.requests += row.requests;
      entry.denied += row.denied;
      byOperation.set(key, entry);
    }
    return {
      day,
      resetsAt: nextQuotaReset(now).toISOString(),
      limits: { daily: this.config.dailyUnits, background: limits.background, user: limits.user },
      used: { total: sum(() => true), background: sum((r) => r.lane === "background"), user: sum((r) => r.lane === "user") },
      denied: sum(() => true, "denied"),
      byOperation: [...byOperation.values()].sort((a, b) => b.units - a.units),
    };
  }

  /** Units a user has left today (for UI hints). */
  async remainingForUser(userId: string, tier = "default", now: Date = new Date()): Promise<number> {
    const [rows, override] = await Promise.all([this.store.usage(quotaDay(now)), this.userOverride(userId)]);
    const used = rows.filter((r) => r.lane === "user" && r.userKey === userId).reduce((acc, r) => acc + r.units, 0);
    const perUser = override?.dailyUnits === undefined ? this.limits(override?.tier ?? tier).perUser : override.dailyUnits;
    return perUser === null ? Number.POSITIVE_INFINITY : Math.max(perUser - used, 0);
  }

  private async userOverride(userId: string): Promise<{ dailyUnits?: number | null; tier?: string } | null> {
    if (!this.userLimits) return null;
    try {
      return await this.userLimits(userId);
    } catch (error) {
      this.log.warn("user quota limits unavailable", { error });
      return null;
    }
  }

  private async denialReason(context: QuotaContext, userKey: string, units: number, now: Date): Promise<"daily" | "lane" | "user"> {
    if (!userKey) return context.lane === "background" ? "lane" : "daily";
    try {
      const remaining = await this.remainingForUser(userKey, context.tier, now);
      return remaining < units ? "user" : "daily";
    } catch {
      return "daily";
    }
  }
}
