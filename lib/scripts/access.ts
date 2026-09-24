import "server-only";
import { getServices } from "@/lib/services";
import type { PlanId } from "@/lib/billing/plans";

/** Plans the Script Writer is open to, besides the owner. Pro joins when it opens. */
export const WRITER_PLANS: readonly PlanId[] = ["expert"];

/** Can this plan use the writer? The owner always can. */
export function writerOpenTo(plan: PlanId | null | undefined, isOwner: boolean): boolean {
  return isOwner || (plan !== null && plan !== undefined && WRITER_PLANS.includes(plan));
}

/**
 * The check that actually guards the writer. The page's lock is presentation;
 * the server actions call this before spending anything.
 */
export async function hasWriterAccess(current: { user: { id: string }; isOwner: boolean }): Promise<boolean> {
  if (current.isOwner) return true;
  try {
    const state = await getServices().subscriptions.stateFor(current.user.id);
    return writerOpenTo(state.plan.id, false);
  } catch {
    // No plan we can see means no access; the owner was let in above.
    return false;
  }
}
