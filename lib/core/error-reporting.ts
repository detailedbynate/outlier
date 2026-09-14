/**
 * Pluggable error reporting. The logger calls `reportError` for every error-level
 * log that carries an error; an observability tool (Sentry) registers itself at
 * startup. Nothing happens when no reporter is registered (local dev, tests).
 */

type Reporter = (error: unknown, context: Record<string, unknown>) => void;

let reporter: Reporter | null = null;

export function registerErrorReporter(next: Reporter): void {
  reporter = next;
}

export function reportError(error: unknown, context: Record<string, unknown> = {}): void {
  if (!reporter) return;
  try {
    reporter(error, context);
  } catch {
    // Reporting must never break the request that hit the error.
  }
}
