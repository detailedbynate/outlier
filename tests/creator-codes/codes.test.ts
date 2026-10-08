import { describe, expect, it } from "vitest";
import { commissionFor, discountLabel, normalizeCreatorCode, statsFrom, stripeCouponIdFor } from "@/lib/creator-codes/codes";
import { fullPriceCents, PLANS } from "@/lib/billing/plans";

describe("creator codes", () => {
  it("accepts short codes in any case, and nothing that could break a URL", () => {
    expect(normalizeCreatorCode(" NATE ")).toBe("nate");
    expect(normalizeCreatorCode("tech_guy-2")).toBe("tech_guy-2");
    expect(normalizeCreatorCode("a")).toBeNull();
    expect(normalizeCreatorCode("-nate")).toBeNull();
    expect(normalizeCreatorCode("nate/../x")).toBeNull();
    expect(normalizeCreatorCode("x".repeat(21))).toBeNull();
    expect(normalizeCreatorCode(undefined)).toBeNull();
  });

  it("says the offer plainly", () => {
    expect(discountLabel({ discount_percent: 20, discount_months: 2 })).toBe("20% off your first 2 months");
    expect(discountLabel({ discount_percent: 50, discount_months: 1 })).toBe("50% off your first month");
  });

  it("takes the discount off the full price, with a coupon per discount", () => {
    const pro = PLANS.find((plan) => plan.id === "pro")!;
    expect(fullPriceCents(pro)).toBe(1_500);
    expect(Math.round((fullPriceCents(pro) * (100 - 40)) / 100)).toBe(900);
    const code = { code: "sktl", discount_percent: 47, discount_months: 2 };
    expect(stripeCouponIdFor(code)).toBe("creator-sktl-47off-2m");
    expect(stripeCouponIdFor({ ...code, discount_percent: 20 })).not.toBe(stripeCouponIdFor(code));
  });

  it("pays a share of each invoice, inside the code's window", () => {
    const base = { amountCents: 1_900, commissionPercent: 20, commissionMonths: 12 as number | null };
    const first = new Date("2026-01-15T00:00:00Z");
    expect(commissionFor({ ...base, paidAt: first, firstPaidAt: null })).toBe(380);
    expect(commissionFor({ ...base, paidAt: new Date("2026-12-15T00:00:00Z"), firstPaidAt: first })).toBe(380);
    // Twelve months on, the window has closed.
    expect(commissionFor({ ...base, paidAt: new Date("2027-01-15T00:00:00Z"), firstPaidAt: first })).toBeNull();
    // No window: as long as they pay.
    expect(commissionFor({ ...base, commissionMonths: null, paidAt: new Date("2030-01-15T00:00:00Z"), firstPaidAt: first })).toBe(380);
    // A free-trial invoice earns nothing.
    expect(commissionFor({ ...base, amountCents: 0, paidAt: first, firstPaidAt: null })).toBeNull();
  });

  it("adds up what's earned, paid out and owed", () => {
    const stats = statsFrom([
      { stripe_customer_id: "cus_a", amount_cents: 1_900, commission_cents: 380, paid_out_at: "2026-02-01T00:00:00Z" },
      { stripe_customer_id: "cus_a", amount_cents: 1_900, commission_cents: 380, paid_out_at: null },
      { stripe_customer_id: "cus_b", amount_cents: 4_900, commission_cents: 980, paid_out_at: null },
    ]);
    expect(stats).toEqual({ customers: 2, revenueCents: 8_700, earnedCents: 1_740, paidOutCents: 380, owedCents: 1_360 });
  });
});
