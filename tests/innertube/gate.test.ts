import { describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@/lib/core/errors";
import { getInnerTubeGate, InnerTubeBlockedError, InnerTubeGate, looksLikeBlock, resetInnerTubeGate } from "@/lib/innertube/gate";

/**
 * A fake clock: `sleep` jumps time forward instead of waiting, so rate limits,
 * backoff, and breaker cooldowns are exact and the suite stays instant.
 */
function clock() {
  let time = 1_000_000;
  const sleeps: number[] = [];
  return {
    now: () => time,
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      time += ms;
      await Promise.resolve();
    },
    advance: (ms: number) => {
      time += ms;
    },
  };
}

const quiet = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn(), child: vi.fn() } as never;

function gate(options = {}, c = clock()) {
  return {
    clock: c,
    gate: new InnerTubeGate(
      { requestsPerMinute: 60, maxConcurrent: 1, minBackoffMs: 1_000, breakerMs: 60_000, maxBreakerMs: 240_000, ...options },
      { now: c.now, sleep: c.sleep, random: () => 0.5, logger: quiet },
    ),
  };
}

const read = <T>(g: InnerTubeGate, label: string, fn: () => Promise<T>, cacheKey?: string) => g.run({ label, cacheKey }, fn);

describe("looksLikeBlock", () => {
  it.each([
    ["Sign in to confirm you're not a bot", true],
    ["Request failed with status 429", true],
    ["too many requests", true],
    ["Unexpected token < in JSON", false],
  ])("%s", (message, expected) => {
    expect(looksLikeBlock(new Error(message))).toBe(expected);
  });
});

describe("InnerTubeGate", () => {
  it("spaces requests out at the global rate, whoever asks", async () => {
    const { gate: g, clock: c } = gate({ requestsPerMinute: 6 });
    await Promise.all([read(g, "a", async () => 1), read(g, "b", async () => 2), read(g, "c", async () => 3)]);
    // First goes immediately, the other two wait 10s each.
    expect(c.sleeps).toEqual([10_000, 10_000]);
  });

  it("runs one request at a time and queues the rest", async () => {
    const { gate: g } = gate({ requestsPerMinute: 6_000, maxConcurrent: 1 });
    let running = 0;
    let peak = 0;
    const work = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running -= 1;
      return null;
    };
    await Promise.all([read(g, "a", work), read(g, "b", work), read(g, "c", work)]);
    expect(peak).toBe(1);
  });

  it("serves a cached read without going out again", async () => {
    const { gate: g } = gate({ cacheTtlMs: 60_000 });
    const fn = vi.fn(async () => "page");
    expect(await read(g, "channel", fn, "channel:X")).toBe("page");
    expect(await read(g, "channel", fn, "channel:X")).toBe("page");
    expect(fn).toHaveBeenCalledOnce();
    expect(g.takeStats()).toMatchObject({ requests: 1, cacheHits: 1 });
  });

  it("re-reads once the cache entry goes stale", async () => {
    const { gate: g, clock: c } = gate({ cacheTtlMs: 60_000 });
    const fn = vi.fn(async () => "page");
    await read(g, "channel", fn, "channel:X");
    c.advance(61_000);
    await read(g, "channel", fn, "channel:X");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("shares one request between callers asking for the same page at once", async () => {
    const { gate: g } = gate();
    const fn = vi.fn(async () => "page");
    await Promise.all([read(g, "a", fn, "channel:X"), read(g, "b", fn, "channel:X")]);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("drops the oldest entries past the cache limit", async () => {
    const { gate: g } = gate({ maxCacheEntries: 2 });
    for (const key of ["a", "b", "c"]) await read(g, key, async () => key, key);
    const fn = vi.fn(async () => "again");
    await read(g, "a", fn, "a");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("retries a transient failure with doubling backoff", async () => {
    const { gate: g, clock: c } = gate({ maxRetries: 2, minBackoffMs: 1_000, requestsPerMinute: 6_000 });
    const fn = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValue("page");
    expect(await read(g, "channel", fn)).toBe("page");
    expect(c.sleeps).toEqual([1_000, 2_000]);
    expect(g.takeStats()).toMatchObject({ retries: 2, failures: 2 });
  });

  it("gives up after the retry budget", async () => {
    const { gate: g } = gate({ maxRetries: 1, requestsPerMinute: 6_000 });
    const fn = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    await expect(read(g, "channel", fn)).rejects.toThrow("socket hang up");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("pauses everything on a bot check, without retrying it", async () => {
    const { gate: g } = gate();
    const blocked = vi.fn(async () => {
      throw new Error("Sign in to confirm you're not a bot");
    });
    await expect(read(g, "channel", blocked)).rejects.toThrow(InnerTubeBlockedError);
    expect(blocked).toHaveBeenCalledOnce();
    expect(g.state()).toMatchObject({ open: true, trips: 1 });

    const next = vi.fn(async () => "page");
    await expect(read(g, "other", next)).rejects.toThrow(InnerTubeBlockedError);
    expect(next).not.toHaveBeenCalled();
  });

  it("reopens after the cooldown, and doubles it when blocks keep coming", async () => {
    const { gate: g, clock: c } = gate({ breakerMs: 60_000, maxBreakerMs: 240_000 });
    const blocked = async () => {
      throw new Error("429 Too Many Requests");
    };
    await expect(read(g, "a", blocked)).rejects.toThrow(InnerTubeBlockedError);
    c.advance(60_001);
    expect(g.state().open).toBe(false);

    await expect(read(g, "b", blocked)).rejects.toThrow(InnerTubeBlockedError);
    expect(g.state().openUntil!.getTime() - c.now()).toBe(120_000);
    c.advance(120_001);

    await expect(read(g, "c", blocked)).rejects.toThrow(InnerTubeBlockedError);
    expect(g.state().openUntil!.getTime() - c.now()).toBe(240_000);
  });

  it("starts the cooldown over after a good read", async () => {
    const { gate: g, clock: c } = gate({ breakerMs: 60_000 });
    await expect(read(g, "a", async () => {
      throw new Error("captcha");
    })).rejects.toThrow(InnerTubeBlockedError);
    c.advance(60_001);
    await read(g, "b", async () => "page");
    expect(g.state().trips).toBe(0);

    await expect(read(g, "c", async () => {
      throw new Error("captcha");
    })).rejects.toThrow(InnerTubeBlockedError);
    expect(g.state().openUntil!.getTime() - c.now()).toBe(60_000);
  });

  it("pauses after enough plain failures in a row, across callers", async () => {
    const { gate: g } = gate({ maxRetries: 0, failureThreshold: 3, requestsPerMinute: 6_000 });
    const fail = async () => {
      throw new Error("socket hang up");
    };
    await expect(read(g, "a", fail)).rejects.toThrow("socket hang up");
    await expect(read(g, "b", fail)).rejects.toThrow("socket hang up");
    await expect(read(g, "c", fail)).rejects.toThrow(InnerTubeBlockedError);
    expect(g.state().open).toBe(true);
  });

  it("passes a definite answer straight through: no retry, no failure counted", async () => {
    const { gate: g } = gate({ maxRetries: 3 });
    const missing = vi.fn(async () => {
      throw new NotFoundError("YouTube channel", "UC123");
    });
    await expect(read(g, "channel", missing)).rejects.toThrow(NotFoundError);
    expect(missing).toHaveBeenCalledOnce();
    expect(g.state()).toMatchObject({ open: false, failuresInRow: 0 });
  });

  it("rejects requests already waiting when the breaker trips", async () => {
    const { gate: g } = gate({ requestsPerMinute: 6_000, maxConcurrent: 1 });
    const first = read(g, "a", async () => {
      throw new Error("captcha");
    });
    const second = read(g, "b", async () => "page");
    await expect(first).rejects.toThrow(InnerTubeBlockedError);
    await expect(second).rejects.toThrow(InnerTubeBlockedError);
  });

  it("hands every caller the same process-wide gate", () => {
    resetInnerTubeGate();
    expect(getInnerTubeGate()).toBe(getInnerTubeGate());
    resetInnerTubeGate();
  });
});
