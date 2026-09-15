import { AppError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { RateLimitRepository } from "@/lib/database/repositories/rate-limits";

/** Named policies so limits are defined in one place. */
export const RATE_LIMITS = {
  /** Waitlist signups per IP. */
  waitlistIp: { windowSeconds: 3600, maxHits: 5 },
  /** Sign-in attempts per IP (slows password guessing). */
  signInIp: { windowSeconds: 900, maxHits: 10 },
  /** Sign-in attempts per email, across IPs. */
  signInEmail: { windowSeconds: 900, maxHits: 8 },
  /** Channel comparisons per user (each can sync new channels from YouTube). */
  compareUser: { windowSeconds: 3600, maxHits: 30 },
  /** Niche Finder searches per user. */
  nicheUser: { windowSeconds: 3600, maxHits: 40 },
} as const;

export type RateLimitPolicy = keyof typeof RATE_LIMITS;

/** SHA-256 hex digest using Web Crypto (works on Node, Vercel, and Cloudflare Workers). */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Best-effort client IP from proxy headers (Vercel, Cloudflare, generic). */
export function clientIpFrom(headers: Pick<Headers, "get">): string {
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export class RateLimitService {
  private readonly log: Logger;

  constructor(
    private readonly repository: Pick<RateLimitRepository, "hit">,
    /** Mixed into hashes so stored keys can't be reversed to IPs or emails. */
    private readonly salt: string,
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger({ module: "services.rate-limit" });
  }

  /** Count a hit for `identifier` under `policy`; throws RATE_LIMITED when over the limit. */
  async enforce(policy: RateLimitPolicy, identifier: string): Promise<void> {
    const { windowSeconds, maxHits } = RATE_LIMITS[policy];
    const key = `${policy}:${(await sha256Hex(`${this.salt}:${identifier.toLowerCase()}`)).slice(0, 40)}`;
    let result: Awaited<ReturnType<RateLimitRepository["hit"]>>;
    try {
      result = await this.repository.hit(key, windowSeconds, maxHits);
    } catch (error) {
      // A broken limiter must not take the product down; log and allow.
      this.log.error("rate limiter unavailable", { policy, error });
      return;
    }
    if (!result.allowed) {
      const minutes = Math.max(1, Math.ceil((Date.parse(result.resetsAt) - Date.now()) / 60_000));
      this.log.warn("rate limited", { policy, hits: result.hits });
      throw new AppError("RATE_LIMITED", `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, {
        details: { policy, resetsAt: result.resetsAt },
      });
    }
  }
}
