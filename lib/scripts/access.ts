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
  /** The premium writer (Expert and the owner); Haiku 5.5 for now, like Pro. */
  premium: boolean;
  /** No Claude at all: Gemini, then the OpenRouter models. No plan uses it now. */
  basic: boolean;
  /** The limit on scripts, or null for none. */
  limit: RateLimitPolicy | null;
  /**
   * Voice Studio characters a month, or null for none. About 500 is a 30s Short
   * and ElevenLabs costs Outlier ~$0.055 per 1,000, so Pro's 10,000 (~20 Shorts)
   * and Expert's 30,000 (~2 a day) each cost about 5.5% of the plan's price.
   */
  voiceCharacters: number | null;
  /** What the form says about the limit. */
  limitNote: string | null;
}

const OWNER_TERMS: WriterTerms = { premium: true, basic: false, limit: null, voiceCharacters: null, limitNote: null };
const PRO_TERMS: WriterTerms = { premium: false, basic: false, limit: "scriptUser", voiceCharacters: 10_000, limitNote: "one script every 6 hours" };
const PLAN_TERMS: Partial<Record<PlanId, WriterTerms>> = {
  expert: { premium: true, basic: false, limit: "scriptExpert", voiceCharacters: 30_000, limitNote: "4 scripts a day" },
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
