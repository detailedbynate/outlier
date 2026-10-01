import "server-only";
import { getServices } from "@/lib/services";
import { opensPaidFeatures } from "./features";

/**
 * Is this person kept out of the paid tools? Staff never are. A plan lookup
 * that fails counts as Free: a locked page is better than a free ride.
 */
export async function paidFeaturesLocked(current: { user: { id: string }; isAdmin: boolean }): Promise<boolean> {
  if (current.isAdmin) return false;
  try {
    const { plan } = await getServices().subscriptions.stateFor(current.user.id);
    return !opensPaidFeatures(plan.priceCents, false);
  } catch {
    return true;
  }
}
