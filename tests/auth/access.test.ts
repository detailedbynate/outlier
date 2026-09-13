import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isEmailAllowed, parseAllowedEmails, safeRedirectPath } from "@/lib/auth/access";
import { apiHandler } from "@/lib/api/handler";
import { resetEnvCache } from "@/lib/core/env";

describe("access rules", () => {
  it("allows any signed-in email when no allowlist is set", () => {
    expect(isEmailAllowed("a@b.com", parseAllowedEmails(undefined))).toBe(true);
    expect(isEmailAllowed(null, parseAllowedEmails(undefined))).toBe(false);
  });

  it("enforces the allowlist case-insensitively", () => {
    const allowed = parseAllowedEmails(" Nate@Example.com , other@x.io ,");
    expect(isEmailAllowed("nate@example.com", allowed)).toBe(true);
    expect(isEmailAllowed("stranger@example.com", allowed)).toBe(false);
  });

  it("only redirects to same-site paths", () => {
    expect(safeRedirectPath("/channels/UC123?x=1")).toBe("/channels/UC123?x=1");
    expect(safeRedirectPath("//evil.com")).toBe("/");
    expect(safeRedirectPath("/\\evil.com")).toBe("/");
    expect(safeRedirectPath("https://evil.com")).toBe("/");
    expect(safeRedirectPath(undefined)).toBe("/");
  });
});

describe("cron auth", () => {
  const ctx = { params: Promise.resolve({}) };
  const handler = apiHandler({ auth: "cron" }, async () => "ran");

  beforeEach(() => resetEnvCache());
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("requires the configured secret", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    const ok = await handler(new Request("http://x/api/cron/tick", { method: "POST", headers: { authorization: "Bearer cron-secret" } }), ctx);
    const bad = await handler(new Request("http://x/api/cron/tick", { method: "POST", headers: { authorization: "Bearer nope" } }), ctx);
    expect(ok.status).toBe(200);
    expect(bad.status).toBe(401);
  });

  it("refuses to run when CRON_SECRET is not set", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await handler(new Request("http://x/api/cron/tick", { method: "POST", headers: { authorization: "Bearer " } }), ctx);
    expect(res.status).toBe(500);
  });
});
