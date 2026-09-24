import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The script writer is open to the owner and the Expert plan only.
 *
 * The blur on the page is presentation: a member who opens devtools can find the
 * server action's id in the shared client bundle and POST to it directly. These
 * tests are about the only thing that actually stops them — the check inside the
 * action — so a later refactor can't quietly drop it.
 */

const write = vi.fn();
const assertAvailable = vi.fn();
const enforce = vi.fn();
const charge = vi.fn();
const plans: Record<string, "free" | "pro" | "expert"> = { "member-1": "pro", "free-1": "free", "expert-1": "expert" };
const stateFor = vi.fn(async (userId: string) => ({ plan: { id: plans[userId] ?? "free" } }));
let currentUser: { user: { id: string }; isOwner: boolean };

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireApprovedUser: async () => currentUser }));
vi.mock("@/lib/core/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/youtube/quota-context", () => ({ asUser: async (_id: string, _op: string, run: () => unknown) => run() }));
vi.mock("@/lib/services", () => ({
  getServices: () => ({ scripts: { write }, credits: { assertAvailable, charge }, rateLimits: { enforce }, subscriptions: { stateFor } }),
}));

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
};

const valid = { topic: "minecraft", idea: "the redstone trick nobody uses", angle: "", seconds: "30", tone: "energetic" };

describe("writeScript access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    charge.mockResolvedValue({ charged: 8 });
    assertAvailable.mockResolvedValue(undefined);
    enforce.mockResolvedValue(undefined);
    write.mockResolvedValue({ script: { beats: [] }, sources: [], seconds: 30, model: "test" });
  });

  it("refuses a member posting straight to the action", async () => {
    currentUser = { user: { id: "member-1" }, isOwner: false };
    const { writeScript } = await import("@/app/research/scriptwriter/actions");
    const { emptyScriptState } = await import("@/app/research/scriptwriter/state");

    const state = await writeScript(emptyScriptState, form(valid));

    expect(state.error).toBe("The Script Writer is on the Expert plan.");
    expect(state.result).toBeNull();
    // Nothing was generated, and nothing was charged for.
    expect(write).not.toHaveBeenCalled();
    expect(assertAvailable).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
    // Refused before the limiter, so a member can't burn the owner's window either.
    expect(enforce).not.toHaveBeenCalled();
  });

  it("refuses before it even checks the input, so nothing leaks through a validation path", async () => {
    currentUser = { user: { id: "member-1" }, isOwner: false };
    const { writeScript } = await import("@/app/research/scriptwriter/actions");
    const { emptyScriptState } = await import("@/app/research/scriptwriter/state");

    const state = await writeScript(emptyScriptState, form({ ...valid, topic: "", idea: "" }));

    expect(state.error).toBe("The Script Writer is on the Expert plan.");
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses the free plan too", async () => {
    currentUser = { user: { id: "free-1" }, isOwner: false };
    const { writeScript } = await import("@/app/research/scriptwriter/actions");
    const { emptyScriptState } = await import("@/app/research/scriptwriter/state");
    expect((await writeScript(emptyScriptState, form(valid))).error).toBe("The Script Writer is on the Expert plan.");
    expect(write).not.toHaveBeenCalled();
  });

  it("writes for Expert, on the standard model and the three hour limit", async () => {
    currentUser = { user: { id: "expert-1" }, isOwner: false };
    const { writeScript } = await import("@/app/research/scriptwriter/actions");
    const { emptyScriptState } = await import("@/app/research/scriptwriter/state");

    const state = await writeScript(emptyScriptState, form(valid));

    expect(state.error).toBeNull();
    expect(write).toHaveBeenCalledWith(expect.anything(), "expert-1", { premium: false });
    expect(enforce).toHaveBeenCalledWith("scriptUser", "expert-1");
    expect(charge).toHaveBeenCalled();
  });

  it("writes for the owner", async () => {
    currentUser = { user: { id: "owner-1" }, isOwner: true };
    const { writeScript } = await import("@/app/research/scriptwriter/actions");
    const { emptyScriptState } = await import("@/app/research/scriptwriter/state");

    const state = await writeScript(emptyScriptState, form(valid));

    expect(state.error).toBeNull();
    expect(state.result).not.toBeNull();
    expect(state.charged).toBe(8);
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ topic: "minecraft", targetSeconds: 30, tone: "energetic" }), "owner-1", { premium: true });
    // No three hour wait for the owner: they're the one testing it, and paying for it.
    expect(enforce).not.toHaveBeenCalled();
  });
});
