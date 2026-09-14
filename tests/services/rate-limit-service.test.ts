import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/lib/core/logger";
import { clientIpFrom, RateLimitService, sha256Hex } from "@/lib/services/rate-limit-service";

describe("RateLimitService", () => {
  it("hashes identifiers into keys and allows requests under the limit", async () => {
    const hit = vi.fn(async () => ({ allowed: true, hits: 1, resetsAt: new Date(Date.now() + 60_000).toISOString() }));
    await new RateLimitService({ hit }, "salt", createLogger()).enforce("waitlistIp", "203.0.113.7");
    const [key, windowSeconds, maxHits] = hit.mock.calls[0] as unknown as [string, number, number];
    expect(key).toMatch(/^waitlistIp:[0-9a-f]{40}$/);
    expect(key).not.toContain("203.0.113.7");
    expect([windowSeconds, maxHits]).toEqual([3600, 5]);
  });

  it("throws RATE_LIMITED with a retry time when over the limit", async () => {
    const hit = vi.fn(async () => ({ allowed: false, hits: 6, resetsAt: new Date(Date.now() + 5 * 60_000).toISOString() }));
    await expect(new RateLimitService({ hit }, "salt", createLogger()).enforce("signInIp", "1.2.3.4")).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: expect.stringMatching(/5 minutes/),
    });
  });

  it("fails open when the limiter itself is down", async () => {
    const hit = vi.fn(async () => {
      throw new Error("db down");
    });
    await expect(new RateLimitService({ hit }, "salt", createLogger()).enforce("signInEmail", "a@b.co")).resolves.toBeUndefined();
  });

  it("reads the client IP from proxy headers", () => {
    expect(clientIpFrom(new Headers({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
    expect(clientIpFrom(new Headers())).toBe("unknown");
  });

  it("hashes with Web Crypto", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
