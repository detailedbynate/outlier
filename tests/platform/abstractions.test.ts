import { describe, expect, it } from "vitest";
import { AIProviderRegistry } from "@/lib/ai/registry";
import { callMcpTool, createMcpTools, toolInputJsonSchema, type McpDependencies } from "@/lib/mcp";
import { cosineSimilarity, jaccardSimilarity, topK } from "@/lib/search/similarity";
import { workspaceObjectPath } from "@/lib/storage/types";

describe("AI provider registry", () => {
  it("fails loudly with NOT_IMPLEMENTED when no provider is configured", () => {
    const registry = new AIProviderRegistry();
    expect(registry.has("text")).toBe(false);
    expect(() => registry.get("text")).toThrow(expect.objectContaining({ code: "NOT_IMPLEMENTED", status: 501 }));
  });
});

describe("search similarity", () => {
  it("cosineSimilarity", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(() => cosineSimilarity([1], [1, 2])).toThrow();
  });

  it("jaccardSimilarity is case-insensitive", () => {
    expect(jaccardSimilarity(["AI", "tools"], ["ai", "coding"])).toBeCloseTo(1 / 3);
    expect(jaccardSimilarity([], [])).toBe(0);
  });

  it("topK sorts descending", () => {
    expect(topK([1, 5, 3], (x) => x, 2).map((r) => r.item)).toEqual([5, 3]);
  });
});

describe("storage paths", () => {
  it("namespaces by workspace and blocks traversal", () => {
    expect(workspaceObjectPath("ws1", "thumbnails", "a.png")).toBe("workspaces/ws1/thumbnails/a.png");
    expect(() => workspaceObjectPath("ws1", "..", "a.png")).toThrow();
    expect(() => workspaceObjectPath("ws1", "x", "../../etc")).toThrow();
  });
});

describe("MCP tools", () => {
  const calls: string[] = [];
  const deps = {
    channels: {
      lookupChannel: async (id: string) => {
        calls.push(id);
        return { id };
      },
      listChannelVideos: async () => ({ items: [] }),
    },
    videos: { analyzeVideo: async () => ({}) },
    discovery: { search: async () => ({ items: [] }) },
  } as unknown as McpDependencies;
  const tools = createMcpTools(deps);

  it("exposes unique names and JSON Schema inputs", () => {
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of tools) {
      expect(toolInputJsonSchema(tool)).toMatchObject({ type: "object" });
    }
  });

  it("validates input before calling services", async () => {
    await expect(callMcpTool(tools, "youtube_get_channel", {}, { workspaceId: null, userId: null })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(
      callMcpTool(tools, "youtube_get_channel", { identifier: "@mkbhd" }, { workspaceId: null, userId: null }),
    ).resolves.toEqual({ id: "@mkbhd" });
    expect(calls).toEqual(["@mkbhd"]);
  });
});
