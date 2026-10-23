import { findPlan } from "@/lib/billing/plans";
import { formatPrice } from "@/lib/billing/packs";
import { priceCentsFor } from "@/lib/billing/subscriptions";

/** Outlier's side of the comparison, priced from the live plan so a sale ending updates it. */
export function outlierFacts(now: Date = new Date()) {
  const pro = findPlan("pro")!;
  const price = formatPrice(priceCentsFor(pro, now));
  return {
    price,
    priceLine: `Pro ${price}/mo, cancel any time`,
    about:
      "Shorts research for gaming and faceless creators: viral Shorts from small channels, a niche finder, a Shorts script writer, voiceovers and word-by-word captions.",
  };
}
