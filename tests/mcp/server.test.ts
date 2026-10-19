import { describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpDeps } from "@/lib/mcp/server";
import { generateMcpToken, hashMcpToken, TOKEN_PREFIX } from "@/lib/mcp/tokens";

const channel = {
  channel_id: "c1",
  youtube_channel_id: "UCaaaaaaaaaaaaaaaaaaaaaa",
  title: "Monster Lab",
  handle: "@monsterlab",
  subscriber_count: 12_000,
  avg_short_views: 40_000,
  median_short_views: 20_000,
  shorts_per_week: 5,
  last_short_at: "2026-10-18T00:00:00Z",
  country: "US",
  niche_category: "Gaming",
  niche_labels: ["my singing monsters"],
  faceless: true,
  ypp: false,
  recentShorts: [{ title: "Rarest monster", view_count: 90_000, youtube_video_id: "v1" }],
};

function deps(over: Partial<McpDeps["research"]> = {}): McpDeps {
  return {
    research: {
      browseShortsChannels: vi.fn(async () => ({ channels: [channel] as never, terms: ["msm"] })),
      similarShortsChannels: vi.fn(async () => [{ ...channel, similarity: 0.88 }] as never),
      findChannelByReference: vi.fn(async () => null),
      peerBreakouts: vi.fn(async () => []),
      ...over,
    },
    videos: { feed: vi.fn(async () => []) },
    targetCountries: ["US", "GB"],
    siteUrl: "https://useoutlier.online",
  };
}

const call = (name: string, args: unknown, d = deps()) => handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, d) as Promise<{ result: { content: { text: string }[]; isError: boolean; structuredContent?: Record<string, unknown> } }>;

describe("Outlier MCP server", () => {
  it("negotiates the protocol version and says it has tools", async () => {
    const res = (await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18" } }, deps())) as { result: Record<string, unknown> };
    expect(res.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "outlier" } });
    const newer = (await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2099-01-01" } }, deps())) as { result: { protocolVersion: string } };
    expect(newer.result.protocolVersion).toBe("2025-11-25");
  });

  it("lists read-only tools with JSON Schemas", async () => {
    const res = (await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, deps())) as { result: { tools: { name: string; inputSchema: { type: string; properties: object }; annotations: { readOnlyHint: boolean } }[] } };
    expect(res.result.tools.map((t) => t.name)).toEqual(["search_shorts_channels", "find_similar_channels", "whats_working_for_peers", "viral_shorts", "removed_channels"]);
    for (const tool of res.result.tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.annotations.readOnlyHint).toBe(true);
    }
  });

  it("searches channels with the English-market filter by default", async () => {
    const d = deps();
    const res = await call("search_shorts_channels", { query: "msm", faceless: true, limit: 5 }, d);
    expect(res.result.isError).toBe(false);
    expect(d.research.browseShortsChannels).toHaveBeenCalledWith("msm", expect.objectContaining({ faceless: true, limit: 5, orderBy: "underrated_score", targetMarket: { countries: ["US", "GB"] } }), 3);
    const out = res.result.structuredContent as { channels: { outlier_url: string; niche: string; faceless: boolean }[] };
    expect(out.channels[0]).toMatchObject({ outlier_url: "https://useoutlier.online/channels/UCaaaaaaaaaaaaaaaaaaaaaa", niche: "Gaming, my singing monsters", faceless: true });
  });

  it("explains when a channel isn't in the library, as a tool error", async () => {
    const res = await call("find_similar_channels", { channel: "@nobody" });
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0]!.text).toContain("isn't in the Outlier library");
  });

  it("gives similar channels a match percent", async () => {
    const res = await call("find_similar_channels", { channel: "@monsterlab" }, deps({ findChannelByReference: vi.fn(async () => ({ id: "c0", title: "Target" }) as never) }));
    expect((res.result.structuredContent as { channels: { match_percent: number }[] }).channels[0]!.match_percent).toBe(90);
  });

  it("rejects bad arguments without calling anything", async () => {
    const d = deps();
    const res = await call("search_shorts_channels", { limit: 500 }, d);
    expect(res.result.isError).toBe(true);
    expect(d.research.browseShortsChannels).not.toHaveBeenCalled();
  });

  it("ignores notifications and refuses unknown methods", async () => {
    expect(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, deps())).toBeNull();
    expect(await handleMcpMessage({ jsonrpc: "2.0", id: 3, method: "resources/list" }, deps())).toMatchObject({ error: { code: -32601 } });
    expect(await handleMcpMessage({ nope: true }, deps())).toMatchObject({ error: { code: -32600 } });
  });
});

describe("MCP tokens", () => {
  it("are long, prefixed and hashed consistently", async () => {
    const { token, prefix } = generateMcpToken();
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(token.length).toBeGreaterThan(40);
    expect(token.startsWith(prefix)).toBe(true);
    expect(await hashMcpToken(token)).toBe(await hashMcpToken(token));
    expect(generateMcpToken().token).not.toBe(token);
  });
});
