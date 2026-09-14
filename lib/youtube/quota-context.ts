import { AsyncLocalStorage } from "node:async_hooks";
import type { QuotaLane } from "@/types/database";

/**
 * Who a YouTube request is for. Set once at the edge of a unit of work (a job
 * run, a server action, an API request) and read by the quota gate for every
 * API call inside it, so services don't have to thread it through.
 */
export interface QuotaContext {
  lane: QuotaLane;
  /** Short label for usage reports, e.g. "job:monitor.videos" or "action:track_channel". */
  operation: string;
  userId?: string | null;
  /** Subscription tier for per-user limits (defaults to "default"). */
  tier?: string;
  /** Skip cached responses (e.g. monitoring that needs fresh statistics). */
  fresh?: boolean;
}

const storage = new AsyncLocalStorage<QuotaContext>();

/** Requests made outside any context count as unattributed user-lane work. */
export const DEFAULT_QUOTA_CONTEXT: QuotaContext = { lane: "user", operation: "unscoped" };

export function runWithQuotaContext<T>(context: QuotaContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentQuotaContext(): QuotaContext {
  return storage.getStore() ?? DEFAULT_QUOTA_CONTEXT;
}

/** Shorthand for user-triggered work. */
export function asUser<T>(userId: string | null, operation: string, fn: () => T): T {
  return runWithQuotaContext({ lane: "user", userId, operation }, fn);
}

/** Shorthand for background work (jobs, schedulers). */
export function asBackground<T>(operation: string, fn: () => T, options: { fresh?: boolean } = {}): T {
  return runWithQuotaContext({ lane: "background", operation, ...options }, fn);
}
