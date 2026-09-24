import { AppError } from "@/lib/core/errors";

/**
 * An empty Anthropic balance. The account is prepaid, so when it runs out every
 * Claude call fails the same way until it's topped up.
 *
 * Scripts stop here instead of dropping to the free models: a paying member
 * would rather hear the writer is paused than get a noticeably worse script.
 * Background work like labeling still falls through to the free models.
 */
export class AiBalanceEmptyError extends AppError {
  constructor(cause?: unknown) {
    super("UPSTREAM_ERROR", "The script writer is paused for a little while. Try again later — nothing was charged.", {
      cause,
      expose: true,
      retryable: false,
    });
  }
}

/** Anthropic's reply when the prepaid balance is spent: a 400 whose message names the credit balance. */
export function isCreditBalanceError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const status = (error as { status?: unknown }).status;
  const message = String((error as { message?: unknown }).message ?? "");
  return (status === 400 || status === 402 || status === 403) && /credit balance/i.test(message);
}

/** How often the owner hears about it: once is enough to act on, every call would be spam. */
const ALERT_EVERY_MS = 6 * 60 * 60 * 1000;

let notify: ((detail: string) => Promise<void>) | null = null;
let lastAlertAt: number | null = null;

/** Wired up once at startup with whatever tells the owner (an email today). */
export function onBalanceEmpty(handler: (detail: string) => Promise<void>): void {
  notify = handler;
}

/** Tells the owner, at most once every six hours per process. Never throws. */
export function reportBalanceEmpty(detail: string, now = Date.now()): void {
  if (!notify || (lastAlertAt !== null && now - lastAlertAt < ALERT_EVERY_MS)) return;
  lastAlertAt = now;
  notify(detail).catch(() => {
    // The alert is best effort; the error the caller sees matters more.
  });
}

/** For tests. */
export function resetBalanceAlert(): void {
  notify = null;
  lastAlertAt = null;
}
