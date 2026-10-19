import { describe, expect, it, vi } from "vitest";
import type { ChannelTraitRepository } from "@/lib/database/repositories/traits";
import { ChannelTraitsService, yppEligible } from "@/lib/services/channel-traits-service";

describe("yppEligible", () => {
  it("needs both 1,000 subscribers and 10M Shorts views in 90 days", () => {
    expect(yppEligible(5_000, 12_000_000)).toBe(true);
    expect(yppEligible(900, 50_000_000)).toBe(false);
    expect(yppEligible(5_000, 9_000_000)).toBe(false);
    expect(yppEligible(null, undefined)).toBe(false);
  });
});

describe("ChannelTraitsService.classifyPending", () => {
  function setup(verdicts: string[]) {
    const generateObject = vi.fn();
    for (const verdict of verdicts) generateObject.mockResolvedValueOnce({ object: { verdict }, model: "claude-haiku-5-5", usage: { inputTokens: 1, outputTokens: 1 } });
    const traits = {
      dueForFacelessCheck: vi.fn(async () => ["a", "b", "c"]),
      saveFaceless: vi.fn(async () => {}),
    };
    const preview = (id: string) => ({ youtube_video_id: id });
    const videos = {
      latestShortsByChannel: vi.fn(async () => new Map([["a", [preview("a1"), preview("a2")]], ["b", [preview("b1"), preview("b2"), preview("b3")]], ["c", [preview("c1")]]])),
    };
    const service = new ChannelTraitsService({ vision: { name: "anthropic", generateText: vi.fn(), generateObject } as never, traits: traits as unknown as ChannelTraitRepository, videos: videos as never });
    return { service, generateObject, traits };
  }

  it("asks about each channel's thumbnails and saves the verdict", async () => {
    const { service, generateObject, traits } = setup(["faceless", "unsure"]);
    const result = await service.classifyPending({ maxChannels: 10 });
    expect(result).toEqual({ checked: 3, faceless: 1 });
    const first = (generateObject.mock.calls[0] as unknown as [{ messages: { images: string[] }[] }])[0];
    expect(first.messages[0]!.images).toEqual(["https://i.ytimg.com/vi/a1/mqdefault.jpg", "https://i.ytimg.com/vi/a2/mqdefault.jpg"]);
    const saved = traits.saveFaceless.mock.calls.map((c) => (c as unknown as [{ channelId: string; faceless: boolean | null }[]])[0][0]);
    // Unsure is stored as unknown; one thumbnail isn't enough to ask about.
    expect(saved.map((s) => [s?.channelId, s?.faceless])).toEqual([["a", true], ["b", null], ["c", null]]);
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it("stops for the hour when the model call fails (e.g. budget used up)", async () => {
    const { service, generateObject, traits } = setup([]);
    generateObject.mockRejectedValue(new Error("This month's Claude budget is used up."));
    expect(await service.classifyPending({ maxChannels: 10 })).toEqual({ checked: 0, faceless: 0 });
    expect(traits.saveFaceless).not.toHaveBeenCalled();
  });

  it("does nothing without Claude", async () => {
    const service = new ChannelTraitsService({ vision: null, traits: {} as ChannelTraitRepository, videos: {} as never });
    expect((await service.classifyPending({ maxChannels: 5 })).skipped).toBeDefined();
  });
});
