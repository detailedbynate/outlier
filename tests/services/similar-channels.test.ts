import { describe, expect, it, vi } from "vitest";
import { normalize, OpenRouterEmbeddingProvider } from "@/lib/ai/embeddings";
import { createLogger } from "@/lib/core/logger";
import type { ChannelRepository } from "@/lib/database/repositories/channels";
import type { EmbeddingRepository, EmbeddingSource } from "@/lib/database/repositories/embeddings";
import type { UsageRepository } from "@/lib/database/repositories/usage";
import { looksLikeChannelReference, ResearchService } from "@/lib/services/research-service";
import { embeddingText, matchPercent, SimilarChannelsService } from "@/lib/services/similar-channels-service";
import { peerPlanUserPrompt } from "@/lib/scripts/peer-ideas";
import type { YouTubeService } from "@/lib/youtube/service";

const source = (over: Partial<EmbeddingSource> = {}): EmbeddingSource => ({
  channel_id: "c1",
  title: "Monster Lab",
  handle: "monsterlab",
  description: "Daily My Singing Monsters tips https://discord.gg/x  and more",
  keywords: ["msm", "my singing monsters"],
  niche_category: "Gaming",
  niche_labels: ["my singing monsters"],
  recent_titles: ["Rarest monster ever", "Breeding guide"],
  ...over,
});

describe("embeddingText", () => {
  it("combines the channel's own text with its latest upload titles, minus links", () => {
    const text = embeddingText(source());
    expect(text).toContain("Channel: Monster Lab (@monsterlab)");
    expect(text).toContain("Niche: Gaming, my singing monsters");
    expect(text).toContain("About: Daily My Singing Monsters tips and more");
    expect(text).not.toContain("discord.gg");
    expect(text).toContain("- Breeding guide");
  });

  it("leaves out what a channel doesn't have", () => {
    const text = embeddingText(source({ handle: null, description: null, keywords: [], niche_category: null, niche_labels: [], recent_titles: [] }));
    expect(text).toBe("Channel: Monster Lab");
  });
});

describe("OpenRouterEmbeddingProvider", () => {
  it("asks for 256 dimensions and returns unit vectors in input order", async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ index: 1, embedding: [0, 2] }, { index: 0, embedding: [3, 4] }], usage: { prompt_tokens: 12 } }), { status: 200 }),
    );
    const provider = new OpenRouterEmbeddingProvider({ apiKey: "k", fetch: fetch as unknown as typeof globalThis.fetch });
    const vectors = await provider.embed(["a", "b"]);
    expect(vectors).toEqual([[0.6, 0.8], [0, 1]]);
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ dimensions: 256, input: ["a", "b"] });
    expect(provider.tokens).toBe(12);
  });

  it("fails loudly, and retryably on 429", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: "slow down" } }), { status: 429 }));
    const provider = new OpenRouterEmbeddingProvider({ apiKey: "k", fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(provider.embed(["a"])).rejects.toMatchObject({ retryable: true });
  });

  it("normalizes zero vectors without dividing by zero", () => {
    expect(normalize([0, 0])).toEqual([0, 0]);
  });
});

describe("SimilarChannelsService", () => {
  function setup(hashes = new Map<string, string>()) {
    const embed = vi.fn(async (inputs: string[]) => inputs.map(() => [1, 0]));
    const repo = {
      dueForEmbedding: vi.fn(async () => ["c1", "c2"]),
      sources: vi.fn(async (ids: string[]) => ids.map((id) => source({ channel_id: id }))),
      hashes: vi.fn(async () => hashes),
      save: vi.fn(async () => {}),
      touch: vi.fn(async () => {}),
      has: vi.fn(async () => true),
      similar: vi.fn(async () => [
        { channelId: "c2", similarity: 0.9 },
        { channelId: "c3", similarity: 0.5 },
      ]),
    };
    const service = new SimilarChannelsService({ embedder: { model: "m", embed }, embeddings: repo as unknown as EmbeddingRepository });
    return { service, embed, repo };
  }

  it("embeds what's due and skips channels whose text hasn't changed", async () => {
    const first = setup();
    await first.service.embedPending({ maxChannels: 10 });
    const saved = (first.repo.save.mock.calls[0] as unknown as [{ channelId: string; sourceHash: string }[]])[0];
    expect(saved.map((s) => s.channelId)).toEqual(["c1", "c2"]);

    // Same text again: c1 is only marked fresh, c2 changed.
    const again = setup(new Map([["c1", saved[0]!.sourceHash]]));
    again.repo.sources.mockImplementation(async (ids: string[]) => ids.map((id) => source({ channel_id: id, title: id === "c2" ? "Renamed" : "Monster Lab" })));
    const result = await again.service.embedPending({ maxChannels: 10 });
    expect(result).toEqual({ embedded: 1, unchanged: 1 });
    expect(again.repo.touch).toHaveBeenCalledWith(["c1"], expect.any(Date));
    expect(again.embed).toHaveBeenCalledTimes(1);
  });

  it("drops weak matches and embeds a channel it hasn't seen yet", async () => {
    const { service, repo, embed } = setup();
    repo.has.mockResolvedValueOnce(false);
    expect(await service.similarTo("c1")).toEqual([{ channelId: "c2", similarity: 0.9 }]);
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it("does nothing without an API key", async () => {
    const service = new SimilarChannelsService({ embedder: null, embeddings: {} as EmbeddingRepository });
    expect(service.enabled).toBe(false);
    expect(await service.similarTo("c1")).toEqual([]);
    expect((await service.embedPending({ maxChannels: 5 })).skipped).toBeDefined();
  });

  it("shows similarity as a whole percentage", () => {
    // Same niche ~0.88, same broad category ~0.7, unrelated ~0.58.
    expect(matchPercent(0.88)).toBe(90);
    expect(matchPercent(0.7)).toBe(48);
    expect(matchPercent(0.4)).toBe(0);
    expect(matchPercent(1)).toBe(100);
  });
});

describe("looksLikeChannelReference", () => {
  it.each([
    "@MrBeast",
    "UCX6OQ3DkcsbYNE6H8uQQuVA",
    "https://www.youtube.com/@mrbeast",
    "youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA",
    "https://youtube.com/c/somechannel",
  ])("treats %s as a channel", (q) => expect(looksLikeChannelReference(q)).toBe(true));

  it.each(["cooking hacks", "minecraft, roblox", "email@me", ""])("treats %s as a keyword", (q) => expect(looksLikeChannelReference(q)).toBe(false));
});

describe("ResearchService.similarShortsChannels", () => {
  it("returns filtered matches best first with their similarity", async () => {
    const searchShortsChannels = vi.fn(async () => [{ channel_id: "low" }, { channel_id: "high" }] as never);
    const service = new ResearchService(
      {
        youtube: {} as unknown as YouTubeService,
        channels: { searchShortsChannels } as unknown as ChannelRepository,
        usage: {} as unknown as UsageRepository,
        storage: { assertCapacity: async () => ({}) } as never,
        enqueue: vi.fn(),
        similar: {
          similarTo: async () => [
            { channelId: "high", similarity: 0.8 },
            { channelId: "low", similarity: 0.5 },
            { channelId: "filtered-out", similarity: 0.7 },
          ],
        } as never,
      },
      { discoveryDailyLimit: 10, discoveryMaxChannels: 25 },
      createLogger(),
    );
    const rows = await service.similarShortsChannels("target", { orderBy: "avg_short_views", limit: 10 }, 0);
    expect(rows.map((r) => [r.channel_id, r.similarity])).toEqual([
      ["high", 0.8],
      ["low", 0.5],
    ]);
    expect((searchShortsChannels.mock.calls[0] as unknown as [{ channelIds: string[] }])[0].channelIds).toEqual(["high", "low", "filtered-out"]);
  });
});

describe("ResearchService.peerBreakouts", () => {
  it("keeps real outliers from similar channels, at most two per channel", async () => {
    const row = (id: string, channel: string, score: number) => ({ video_id: id, channel_id: channel, outlier_score: score }) as never;
    const feed = vi.fn(async () => [row("v1", "a", 9), row("v2", "a", 8), row("v3", "a", 7), row("v4", "b", 3), row("v5", "c", 1.1)]);
    const service = new ResearchService(
      {
        youtube: {} as unknown as YouTubeService,
        channels: {} as unknown as ChannelRepository,
        videos: { feed, latestShortsByChannel: vi.fn() } as never,
        usage: {} as unknown as UsageRepository,
        storage: { assertCapacity: async () => ({}) } as never,
        enqueue: vi.fn(),
        similar: { similarTo: async () => [{ channelId: "a", similarity: 0.9 }, { channelId: "b", similarity: 0.8 }, { channelId: "c", similarity: 0.7 }] } as never,
      },
      { discoveryDailyLimit: 10, discoveryMaxChannels: 25 },
      createLogger(),
    );
    const rows = await service.peerBreakouts("target", 10, new Date("2026-10-19T00:00:00Z"));
    expect(rows.map((r) => r.video_id)).toEqual(["v1", "v2", "v4"]);
    expect(feed).toHaveBeenCalledWith(expect.objectContaining({ channelIds: ["a", "b", "c"], format: "short", orderBy: "outlier_score" }));
  });
});

describe("peerPlanUserPrompt", () => {
  it("lists the breakouts with how far they beat their channel", () => {
    const prompt = peerPlanUserPrompt({
      channel: "Monster Lab",
      ownTitles: ["Rarest monster"],
      breakouts: [{ title: "I bred every Wubbox", channel: "Wubbox Daily", views: 1_200_000, multiplier: 6.2 }],
    });
    expect(prompt).toContain("Channel: Monster Lab");
    expect(prompt).toContain('- "I bred every Wubbox" (Wubbox Daily, 1,200,000 views, 6.2x usual)');
    expect(prompt).toContain("- Rarest monster");
  });
});
