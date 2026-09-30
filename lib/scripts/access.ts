import "server-only";
import { getServices } from "@/lib/services";
import type { PlanId } from "@/lib/billing/plans";
import type { RateLimitPolicy } from "@/lib/services/rate-limit-service";

/** The page tour runs until this day (UTC), for anyone who hasn't said "don't show again". */
export const SCRIPT_TOUR_UNTIL = "2026-10-13";
export const SCRIPT_TOUR_DISMISSED_KEY = "script_tour_dismissed";

/** Whether to walk this person through the writer page. */
export function showScriptTour(userMetadata: Record<string, unknown> | undefined, now: Date): boolean {
  return now.toISOString().slice(0, 10) <= SCRIPT_TOUR_UNTIL && userMetadata?.[SCRIPT_TOUR_DISMISSED_KEY] !== true;
}

/** Plans the Script Writer is open to, besides the owner. */
export const WRITER_PLANS: readonly PlanId[] = ["pro", "expert"];

/** How each plan uses the writer: which model, and how often. */
interface WriterTerms {
  /** Claude's deeper model (Expert and the owner). */
  premium: boolean;
  /** No Claude at all: Gemini, then the OpenRouter models (Pro). */
  basic: boolean;
  /** The limit on scripts, or null for none. */
  limit: RateLimitPolicy | null;
  /** What the form says about the limit. */
  limitNote: string | null;
}

const OWNER_TERMS: WriterTerms = { premium: true, basic: false, limit: null, limitNote: null };
const PRO_TERMS: WriterTerms = { premium: false, basic: true, limit: "scriptUser", limitNote: "one script every 6 hours" };
const PLAN_TERMS: Partial<Record<PlanId, WriterTerms>> = {
  expert: { premium: true, basic: false, limit: "scriptExpert", limitNote: "4 scripts a day" },
  pro: PRO_TERMS,
};

/** Can this plan use the writer? The owner always can. */
export function writerOpenTo(plan: PlanId | null | undefined, isOwner: boolean): boolean {
  return isOwner || (plan !== null && plan !== undefined && WRITER_PLANS.includes(plan));
}

/** The terms for someone who can write, or null when they can't. */
export function writerTerms(plan: PlanId | null | undefined, isOwner: boolean): WriterTerms | null {
  if (isOwner) return OWNER_TERMS;
  if (!writerOpenTo(plan, false)) return null;
  return PLAN_TERMS[plan!] ?? PRO_TERMS;
}

/**
 * The check that actually guards the writer. The page's lock is presentation;
 * the server actions call this before spending anything.
 */
export async function writerAccess(current: { user: { id: string }; isOwner: boolean }): Promise<WriterTerms | null> {
  if (current.isOwner) return OWNER_TERMS;
  try {
    const { plan } = await getServices().subscriptions.stateFor(current.user.id);
    return writerTerms(plan.id, false);
  } catch {
    // No plan we can see means no access; the owner was let in above.
    return null;
  }
}
