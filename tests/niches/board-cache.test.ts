import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/lib/core/logger";
import { NicheService } from "@/lib/services/niche-service";

const NOW = new Date("2026-10-07T00:00:00Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

function setup() {
  let release: () => void = () => {};
  const recentSample = vi.fn(async () => ({ videos: [], channels: new Map() }));
  const service = new NicheService({ niches: { recentSample } } as never, {}, createLogger());
  return { service, recentSample, hold: () => recentSample.mockImplementationOnce(() => new Promise((r) => (release = () => r({ videos: [], channels: new Map() })))), release: () => release() };
}

describe("Niche Finder board caches", () => {
  it("reads the library once for both boards, and once for callers arriving together", async () => {
    const { service, recentSample } = setup();
    await Promise.all([service.discover("shorts", { now: NOW }), service.discover("shorts", { now: NOW }), service.ideaFeeds("shorts", { now: NOW })]);
    expect(recentSample).toHaveBeenCalledTimes(1);
  });

  it("shows the old board at once when it's stale and refreshes behind it", async () => {
    const { service, recentSample, hold, release } = setup();
    const first = await service.discover("shorts", { now: NOW });
    hold();
    // Seven hours later the refresh is held open, yet the answer comes straight back.
    expect(await service.discover("shorts", { now: hours(7) })).toBe(first);
    expect(recentSample).toHaveBeenCalledTimes(2);
    release();
    await vi.waitFor(async () => expect(await service.discover("shorts", { now: hours(7.5) })).not.toBe(first));
  });

  it("warms both formats from the tick", async () => {
    const { service, recentSample } = setup();
    service.warm(NOW);
    await vi.waitFor(() => expect(recentSample).toHaveBeenCalledTimes(2));
    service.warm(hours(1));
    expect(recentSample).toHaveBeenCalledTimes(2);
  });
});
