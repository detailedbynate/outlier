/** Exponential backoff with jitter for failed job attempts: ~30s, 2m, 8m, ... capped at 1h. */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = 30_000 * 4 ** Math.max(attempt - 1, 0);
  const capped = Math.min(base, 3_600_000);
  const jitter = 0.8 + random() * 0.4; // ±20%
  return Math.round(capped * jitter);
}
