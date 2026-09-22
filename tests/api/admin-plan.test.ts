import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Changing someone's plan is a privilege operation: it hands out paid access
 * without charging anyone. Only the owner may do it, and an admin must not.
 */

const apply = vi.fn();
const stateFor = vi.fn();
let currentUser: { user: { id: string }; isOwner: boolean };

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/session", () => ({ requireAdmin: async () => currentUser }));
vi.mock("@/lib/core/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/services", () => ({ getServices: () => ({ subscriptions: { apply, stateFor } }) }));

const idle = { status: "idle" as const, message: null, link: null };
const USER = "11111111-2222-3333-4444-555555555555";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
};

describe("setAccountPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stateFor.mockResolvedValue({ stripeCustomerId: "cus_123" });
    apply.mockResolvedValue(undefined);
  });

  it("lets the owner put someone on Pro", async () => {
    currentUser = { user: { id: "owner-1" }, isOwner: true };
    const { setAccountPlan } = await import("@/app/admin/accounts/actions");

    const state = await setAccountPlan(idle, form({ userId: USER, plan: "pro" }));

    expect(state.status).toBe("ok");
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ userId: USER, plan: "pro", status: "active" }));
  });

  it("refuses an admin who isn't the owner", async () => {
    currentUser = { user: { id: "admin-1" }, isOwner: false };
    const { setAccountPlan } = await import("@/app/admin/accounts/actions");

    const state = await setAccountPlan(idle, form({ userId: USER, plan: "pro" }));

    expect(state.status).toBe("error");
    expect(apply).not.toHaveBeenCalled();
  });

  it("clears the entitlement when moving someone to Free", async () => {
    currentUser = { user: { id: "owner-1" }, isOwner: true };
    const { setAccountPlan } = await import("@/app/admin/accounts/actions");

    await setAccountPlan(idle, form({ userId: USER, plan: "free" }));

    // "canceled" is what the rest of the app reads as no entitlement.
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ plan: "free", status: "canceled" }));
  });

  it("keeps the Stripe customer, so a real subscription isn't orphaned", async () => {
    currentUser = { user: { id: "owner-1" }, isOwner: true };
    const { setAccountPlan } = await import("@/app/admin/accounts/actions");

    await setAccountPlan(idle, form({ userId: USER, plan: "expert" }));

    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ stripeCustomerId: "cus_123" }));
  });

  it("rejects an unknown plan and a malformed account", async () => {
    currentUser = { user: { id: "owner-1" }, isOwner: true };
    const { setAccountPlan } = await import("@/app/admin/accounts/actions");

    expect((await setAccountPlan(idle, form({ userId: USER, plan: "platinum" }))).status).toBe("error");
    expect((await setAccountPlan(idle, form({ userId: "not-a-uuid", plan: "pro" }))).status).toBe("error");
    expect(apply).not.toHaveBeenCalled();
  });
});
