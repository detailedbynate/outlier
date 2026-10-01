import "server-only";
import { findPlan, onSale, SALE_ENDS_LABEL } from "@/lib/billing/plans";
import { formatPrice } from "@/lib/billing/packs";
import { priceCentsFor } from "@/lib/billing/subscriptions";
import type { FeatureCopy } from "@/lib/billing/features";
import { PaywallDialog } from "./paywall-dialog";

/** A paid tool seen from Free. Works out Pro's price here, where billing config lives, and hands it to the dialog. */
export function Paywall({ feature }: { feature: FeatureCopy }) {
  const pro = findPlan("pro")!;
  const now = new Date();
  const sale = onSale(pro, now);
  return (
    <PaywallDialog
      feature={feature}
      price={{
        now: formatPrice(priceCentsFor(pro, now)),
        was: sale ? formatPrice(pro.listPriceCents!) : null,
        until: sale ? SALE_ENDS_LABEL : null,
        // In the app, Pro is bought outright; the free trial is a landing-page offer.
        trialDays: null,
      }}
    />
  );
}
