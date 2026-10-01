import "server-only";
import { getCurrentUser } from "@/lib/auth/session";
import { FREE_TRIAL_DAYS, findPlan, onSale, SALE_ENDS_LABEL } from "@/lib/billing/plans";
import { freeTrialEligible } from "@/lib/billing/trial";
import { getServices } from "@/lib/services";
import { formatPrice } from "@/lib/billing/packs";
import { priceCentsFor } from "@/lib/billing/subscriptions";
import type { FeatureCopy } from "@/lib/billing/features";
import { PaywallDialog } from "./paywall-dialog";

/** A paid tool seen from Free. Works out Pro's price here, where billing config lives, and hands it to the dialog. */
export async function Paywall({ feature }: { feature: FeatureCopy }) {
  const pro = findPlan("pro")!;
  const now = new Date();
  const sale = onSale(pro, now);
  const current = await getCurrentUser();
  const state = current ? await getServices().subscriptions.stateFor(current.user.id).catch(() => null) : null;
  return (
    <PaywallDialog
      feature={feature}
      price={{
        now: formatPrice(priceCentsFor(pro, now)),
        was: sale ? formatPrice(pro.listPriceCents!) : null,
        until: sale ? SALE_ENDS_LABEL : null,
        trialDays: state && freeTrialEligible(state) ? FREE_TRIAL_DAYS : null,
      }}
    />
  );
}
