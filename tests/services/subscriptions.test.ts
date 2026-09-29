import { afterEach, describe, expect, it, vi } from "vitest";
import { FREE_PLAN, isEntitled, onSale, PLANS, planOrFree, SALE_ENDS_AT } from "@/lib/billing/plans";
import { planForSubscription, priceCentsFor, priceIdFor } from "@/lib/billing/subscriptions";
import { resetEnvCache } from "@/lib/core/env";
import { SubscriptionService } from "@/lib/services/subscription-service";
import type { SubscriptionRepository } from "@/lib/database/repositories/subscriptions";
import type { SubscriptionRow } from "@/types/database";

const NOW = Date.UTC(2026, 8, 20);
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as never;

function row(patch: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    user_id: "u1",
    plan: "pro",
    status: "active",
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_1",
    current_period_end: new Date(NOW + 5 * 86_400_000).toISOString(),
    cancel_at_period_end: false,
    created_at: new Date(NOW).toISOString(),
    updated_at: new Date(NOW).toISOString(),
    ...patch,
  };
}

function build(found: SubscriptionRow | null | (() => never)) {
  const repository = {
    findByUserId: vi.fn(async () => {
      if (typeof found === "function") found();
      return found as SubscriptionRow | null;
    }),
    findByCustomerId: vi.fn(async () => (typeof found === "function" ? null : found)),
    upsert: vi.fn(async (input) => row(input as Partial<SubscriptionRow>)),
    list: vi.fn(async () => []),
  } as unknown as SubscriptionRepository;
  return { service: new SubscriptionService(repository, () => NOW, silent), repository };
}

const pro = PLANS.find((plan) => plan.id === "pro")!;

describe("plans", () => {
  it("prices the launch sale and the list price it returns to", () => {
    expect(pro.priceCents).toBe(1_000);
    expect(pro.listPriceCents).toBe(1_500);
    expect(onSale(pro, new Date(NOW))).toBe(true);
    expect(onSale(pro, new Date(SALE_ENDS_AT))).toBe(false);
    expect(onSale(FREE_PLAN, new Date(NOW))).toBe(false);
  });

  it("treats an unknown plan as free", () => {
    expect(planOrFree("nonsense").id).toBe("free");
    expect(planOrFree(null).monthlyCredits).toBe(50);
  });

  it("keeps a plan running while Stripe retries a failed card", () => {
    expect(["active", "trialing", "past_due"].every(isEntitled)).toBe(true);
    expect(["canceled", "unpaid", "incomplete", "inactive"].some(isEntitled)).toBe(false);
  });
});

describe("launch sale ending", () => {
  const before = new Date(SALE_ENDS_AT - 1);
  const after = new Date(SALE_ENDS_AT);

  function prices(list?: string) {
    vi.stubEnv("STRIPE_PRICE_PRO", "price_pro_launch");
    vi.stubEnv("STRIPE_PRICE_PRO_LIST", list ?? "");
    vi.stubEnv("STRIPE_PRICE_EXPERT", "price_expert");
    resetEnvCache();
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("sells Pro at the launch price until the sale ends", () => {
    prices("price_pro_list");
    expect(priceIdFor(pro, before)).toBe("price_pro_launch");
    expect(priceCentsFor(pro, before)).toBe(1_000);
  });

  it("moves new Pro subscribers to the list price after the sale", () => {
    prices("price_pro_list");
    expect(priceIdFor(pro, after)).toBe("price_pro_list");
    expect(priceCentsFor(pro, after)).toBe(1_500);
  });

  it("keeps showing and charging the launch price if the list Price isn't set up", () => {
    prices();
    expect(priceIdFor(pro, after)).toBe("price_pro_launch");
    expect(priceCentsFor(pro, after)).toBe(1_000);
  });

  it("leaves Expert alone", () => {
    prices("price_pro_list");
    const expert = PLANS.find((plan) => plan.id === "expert")!;
    expect(priceIdFor(expert, after)).toBe("price_expert");
    expect(priceCentsFor(expert, after)).toBe(3_000);
  });

  it("recognises both Pro Prices, so launch subscribers stay on Pro", () => {
    prices("price_pro_list");
    const sub = (price: string) => ({ items: { data: [{ price: { id: price } }] }, metadata: {} }) as never;
    expect(planForSubscription(sub("price_pro_launch"))).toBe("pro");
    expect(planForSubscription(sub("price_pro_list"))).toBe("pro");
    expect(planForSubscription(sub("price_expert"))).toBe("expert");
  });
});

describe("SubscriptionService", () => {
  it("gives a paying user their plan's allowance", async () => {
    const { service } = build(row());
    expect(await service.monthlyCreditsFor("u1")).toBe(pro.monthlyCredits);
  });

  it("gives everyone else the free allowance", async () => {
    expect(await build(null).service.monthlyCreditsFor("u1")).toBe(FREE_PLAN.monthlyCredits);
    expect(await build(row({ status: "canceled" })).service.monthlyCreditsFor("u1")).toBe(FREE_PLAN.monthlyCredits);
  });

  it("keeps the plan until the period they paid for runs out", async () => {
    const cancelling = build(row({ cancel_at_period_end: true }));
    expect(await cancelling.service.monthlyCreditsFor("u1")).toBe(pro.monthlyCredits);

    const lapsed = build(row({ current_period_end: new Date(NOW - 86_400_000).toISOString() }));
    expect(await lapsed.service.monthlyCreditsFor("u1")).toBe(FREE_PLAN.monthlyCredits);
  });

  it("falls back to free when the database is unreachable, rather than failing the request", async () => {
    const { service } = build(() => {
      throw new Error("database down");
    });
    expect(await service.monthlyCreditsFor("u1")).toBe(FREE_PLAN.monthlyCredits);
  });

  it("reuses a looked-up plan instead of asking on every credit check", async () => {
    const { service, repository } = build(row());
    await service.monthlyCreditsFor("u1");
    await service.monthlyCreditsFor("u1");
    expect(repository.findByUserId).toHaveBeenCalledOnce();
    // A webhook writing a new plan has to be visible at once.
    service.invalidate("u1");
    await service.monthlyCreditsFor("u1");
    expect(repository.findByUserId).toHaveBeenCalledTimes(2);
  });

  it("writes what Stripe says and stops serving the old plan", async () => {
    const { service, repository } = build(row());
    await service.monthlyCreditsFor("u1");
    await service.apply({
      userId: "u1",
      plan: "expert",
      status: "active",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
    expect(repository.upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "u1", plan: "expert", status: "active" }));
    // The cached plan is dropped, so the next check reads the new one.
    await service.monthlyCreditsFor("u1");
    expect(repository.findByUserId).toHaveBeenCalledTimes(2);
  });
});
