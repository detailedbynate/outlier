import { describe, expect, it, vi } from "vitest";
import { FREE_PLAN, PLANS } from "@/lib/billing/plans";
import { offerOpen, reminderEvery, timeLeft, TRIAL_OFFER, TRIAL_STATUS, type Trial } from "@/lib/billing/trial";
import { SubscriptionService } from "@/lib/services/subscription-service";
import type { SubscriptionRepository } from "@/lib/database/repositories/subscriptions";
import type { SubscriptionRow } from "@/types/database";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 10, 12);
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as never;
const expert = PLANS.find((p) => p.id === "expert")!;

const trial = (endsIn: number, length = 14 * DAY): Trial => ({
  planId: "expert",
  endsAt: new Date(NOW + endsIn).toISOString(),
  startedAt: new Date(NOW + endsIn - length).toISOString(),
});

function serviceFor(found: Partial<SubscriptionRow>) {
  const row: SubscriptionRow = {
    user_id: "u1",
    plan: "expert",
    status: TRIAL_STATUS,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    current_period_end: new Date(NOW + 2 * DAY).toISOString(),
    cancel_at_period_end: false,
    created_at: new Date(NOW - 5 * DAY).toISOString(),
    updated_at: new Date(NOW - 5 * DAY).toISOString(),
    ...found,
  };
  const repository = { findByUserId: vi.fn(async () => row) } as unknown as SubscriptionRepository;
  return new SubscriptionService(repository, () => NOW, silent);
}

describe("trials", () => {
  it("give the trial plan until the end date, then Free", async () => {
    const running = await serviceFor({}).stateFor("u1");
    expect(running.plan.id).toBe("expert");
    expect(running.trial?.planId).toBe("expert");

    const over = await serviceFor({ current_period_end: new Date(NOW - HOUR).toISOString() }).stateFor("u1");
    expect(over.plan).toBe(FREE_PLAN);
    // Still known as a trial, for the "it's over" reminder and the offer.
    expect(over.trial).not.toBeNull();
  });

  it("are only trials when the row says so", async () => {
    expect((await serviceFor({ status: "active", stripe_subscription_id: "sub_1" }).stateFor("u1")).trial).toBeNull();
    // A trial with no end date would never end: not honoured.
    expect((await serviceFor({ current_period_end: null }).stateFor("u1")).plan).toBe(FREE_PLAN);
  });

  it("remind more often as the end nears", () => {
    expect(reminderEvery(trial(5 * DAY), NOW)).toBeNull();
    expect(reminderEvery(trial(2 * DAY), NOW)).toBe(DAY);
    expect(reminderEvery(trial(12 * HOUR), NOW)).toBe(6 * HOUR);
    expect(reminderEvery(trial(3 * HOUR), NOW)).toBe(HOUR);
    expect(reminderEvery(trial(20 * 60_000), NOW)).toBe(15 * 60_000);
  });

  it("start reminding halfway through a short trial", () => {
    expect(reminderEvery(trial(30 * HOUR, 2 * DAY), NOW)).toBeNull();
    expect(reminderEvery(trial(20 * HOUR, 2 * DAY), NOW)).toBe(6 * HOUR);
  });

  it("keep the Expert offer open for a week after, reminding daily", () => {
    expect(offerOpen(trial(-3 * DAY), NOW)).toBe(true);
    expect(reminderEvery(trial(-3 * DAY), NOW)).toBe(DAY);
    expect(offerOpen(trial(-8 * DAY), NOW)).toBe(false);
    expect(reminderEvery(trial(-8 * DAY), NOW)).toBeNull();
    expect(offerOpen(null, NOW)).toBe(false);
  });

  it("price the offer as Expert minus the coupon", () => {
    expect(expert.priceCents - TRIAL_OFFER.amountOffCents).toBe(TRIAL_OFFER.priceCents);
  });

  it("say how long is left in plain words", () => {
    expect(timeLeft(2 * DAY + 4 * HOUR)).toBe("2 days 4 hours");
    expect(timeLeft(DAY)).toBe("1 day");
    expect(timeLeft(5 * HOUR + 59 * 60_000)).toBe("5 hours");
    expect(timeLeft(40 * 60_000)).toBe("40 minutes");
  });
});
