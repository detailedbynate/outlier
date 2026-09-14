import type { DatabaseClient } from "@/lib/database/client";
import { assertOk, unwrap } from "@/lib/database/errors";

export class RateLimitRepository {
  constructor(private readonly db: DatabaseClient) {}

  async hit(key: string, windowSeconds: number, maxHits: number): Promise<{ allowed: boolean; hits: number; resetsAt: string }> {
    const rows = unwrap(
      await this.db.rpc("rate_limit_hit", { limit_key: key, window_seconds: windowSeconds, max_hits: maxHits }),
      "rate_limits.hit",
    );
    const row = rows[0];
    // If the counter can't be read, fail open rather than locking everyone out.
    return row ? { allowed: row.allowed, hits: row.hits, resetsAt: row.resets_at } : { allowed: true, hits: 0, resetsAt: new Date().toISOString() };
  }

  /** Remove windows that ended long ago. */
  async deleteOlderThan(cutoff: Date): Promise<void> {
    assertOk(await this.db.from("rate_limits").delete().lt("window_start", cutoff.toISOString()), "rate_limits.cleanup");
  }
}
