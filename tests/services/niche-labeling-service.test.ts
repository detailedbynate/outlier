import { describe, expect, it, vi } from "vitest";
import type { TextProvider } from "@/lib/ai/types";
import { AppError } from "@/lib/core/errors";
import { createLogger } from "@/lib/core/logger";
import { RULES_MODEL } from "@/lib/niches/rule-labeler";
import { NicheLabelingService, REVIEWED_MODEL } from "@/lib/services/niche-labeling-service";

const NOW = new Date("2026-09-16T12:00:00Z");

function channel(id: string, titles: string[], title = `Channel ${id}`, labeledAt: string | null = null) {
  return {
    id,
    title,
    niche_labeled_at: labeledAt,
    description: null,
    keywords: [],
    topic_categories: [],
    subscriber_count: 5_000,
    recentTitles: titles,
    recentTags: [],
    uploads: titles.map((t) => ({ title: t, tags: [] })),
  };
}

const clashChannel = (id: string) => channel(id, ["best deck #clashroyale", "clash royale ladder push", "hog cycle guide clash royale", "evo tier list #clashroyale"]);
const vagueChannel = (id: string) => channel(id, ["what a day", "we tried something new", "random stuff"]);

function aiLabel(ref: string, name: string) {
  return { ref, category: "Gaming", primary_kind: "game", primary_name: name, aliases: [], sub_niches: [`${name.toLowerCase()} guides`], formats: ["gameplay"], flags: [], confidence: 0.9 };
}

function setup(options: { pending?: ReturnType<typeof channel>[]; respond?: (call: number) => unknown; ai?: boolean; claude?: (call: number) => unknown } = {}) {
  const saved = new Map<string, Record<string, unknown>>();
  const upserts: { slug: string; kind: string; parentId: string | null }[] = [];
  let calls = 0;
  const generateObject = vi.fn(async () => {
    calls += 1;
    const result = options.respond?.(calls);
    if (result instanceof Error) throw result;
    return { object: result, model: "claude-haiku-4-5", usage: { inputTokens: 1_000, outputTokens: 200 } };
  });
  const refreshChannelCounts = vi.fn(async () => {});
  let claudeCalls = 0;
  const claudeObject = vi.fn(async () => {
    claudeCalls += 1;
    const result = options.claude?.(claudeCalls);
    if (result instanceof Error) throw result;
    return { object: result, model: "claude-haiku-5-5", usage: { inputTokens: 500, outputTokens: 100 } };
  });
  const listUnlabeled = vi.fn(async (limit: number, _options?: unknown) => (options.pending ?? []).slice(0, limit));
  const service = new NicheLabelingService(
    {
      text: options.ai ? ({ name: "fake", generateText: vi.fn(), generateObject } as unknown as TextProvider) : null,
      claude: options.claude ? ({ name: "anthropic", generateText: vi.fn(), generateObject: claudeObject } as unknown as TextProvider) : null,
      channels: {
        listUnlabeled,
        saveNicheLabel: async (id: string, value: Record<string, unknown>) => {
          saved.set(id, value);
        },
      } as never,
      niches: {
        upsertEntity: async (entity: { slug: string; kind: string; parentId: string | null }) => {
          upserts.push(entity);
          return `niche-${entity.slug}`;
        },
        refreshChannelCounts,
      } as never,
    },
    { batchSize: 2 },
    createLogger(),
  );
  return { service, saved, upserts, generateObject, claudeObject, listUnlabeled, refreshChannelCounts };
}

describe("NicheLabelingService", () => {
  it("doesn't rewrite channels it already labeled when the AI couldn't get to them", async () => {
    const earlier = "2026-09-16T00:00:00Z";
    const { service, saved } = setup({
      ai: true,
      pending: [channel("old", ["what a day", "random stuff"], "Old", earlier), vagueChannel("new")],
      respond: () => new Error("429 quota"),
    });
    const result = await service.labelPending({ maxChannels: 10, now: () => NOW });
    expect(saved.has("old")).toBe(false);
    expect(saved.get("new")).toMatchObject({ model: RULES_MODEL });
    expect(result.labeled).toBe(1);
  });

  it("labels channels for free with rules when there's no AI provider", async () => {
    const { service, saved, upserts, generateObject, refreshChannelCounts } = setup({ pending: [clashChannel("a"), clashChannel("b"), vagueChannel("c")] });
    const result = await service.labelPending({ maxChannels: 10, now: () => NOW });

    expect(result).toMatchObject({ labeled: 3, byAi: 0, categoryOnly: 1, batches: 0 });
    expect(generateObject).not.toHaveBeenCalled();
    expect(saved.get("a")).toMatchObject({ nicheId: "niche-clash-royale", category: "Gaming", model: RULES_MODEL });
    // Nothing clear: the channel still gets its category, and isn't retried every hour.
    expect(saved.get("c")).toMatchObject({ nicheId: "niche-other", category: "Other", model: RULES_MODEL });
    // Entities are looked up once per run, not once per channel.
    expect(upserts.filter((u) => u.slug === "clash-royale")).toHaveLength(1);
    expect(upserts.find((u) => u.slug === "clash-royale")).toMatchObject({ kind: "game", parentId: "niche-gaming" });
    expect(refreshChannelCounts).toHaveBeenCalledTimes(1);
  });

  it("only sends channels the rules are unsure about to AI, when a provider exists", async () => {
    const { service, saved, generateObject } = setup({
      ai: true,
      pending: [clashChannel("a"), vagueChannel("b"), vagueChannel("c")],
      respond: () => ({ channels: [aiLabel("c1", "Minecraft"), aiLabel("c2", "Terraria")] }),
    });
    const result = await service.labelPending({ maxChannels: 10, now: () => NOW });

    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ labeled: 3, byAi: 2, batches: 1, inputTokens: 1_000 });
    expect(saved.get("a")).toMatchObject({ model: RULES_MODEL, nicheId: "niche-clash-royale" });
    expect(saved.get("b")).toMatchObject({ model: "claude-haiku-4-5", nicheId: "niche-minecraft" });
    expect(saved.get("c")).toMatchObject({ nicheId: "niche-terraria" });
  });

  it("with Claude, also gets a second read on channels the rules were sure about, and asks for them", async () => {
    const { service, saved, generateObject, claudeObject, listUnlabeled } = setup({
      ai: true,
      pending: [clashChannel("a"), vagueChannel("b")],
      respond: () => ({ channels: [aiLabel("c1", "Minecraft")] }),
      claude: () => ({ channels: [{ ...aiLabel("c1", "Clash Royale"), sub_niches: ["hog cycle decks"], formats: ["tutorial_guide", "not_a_format"] }] }),
    });
    const result = await service.labelPending({ maxChannels: 10, now: () => NOW });

    expect(listUnlabeled.mock.calls[0]?.[1]).toEqual({ includeUnsureRuleLabels: true, includeRuleLabels: true });
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(claudeObject).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ labeled: 2, byAi: 2 });
    expect(saved.get("a")).toMatchObject({ model: "claude-haiku-5-5", nicheId: "niche-clash-royale", labels: ["hog cycle decks"], formats: ["tutorial_guide"] });
    expect(saved.get("b")).toMatchObject({ nicheId: "niche-minecraft" });
  });

  it("leaves a sure rule label alone, and unreviewed, when Claude's budget is used up", async () => {
    const { AiBudgetSpentError } = await import("@/lib/ai/budget");
    const { service, saved } = setup({
      pending: [channel("a", ["best deck #clashroyale", "clash royale ladder push", "hog cycle guide clash royale", "evo tier list #clashroyale"], "A", "2026-09-10T00:00:00Z")],
      claude: () => new AiBudgetSpentError(),
    });
    const result = await service.labelPending({ maxChannels: 10, now: () => NOW });
    expect(result.labeled).toBe(0);
    expect(saved.has("a")).toBe(false);
  });

  it("keeps the AI's finished batches when the run runs out of time on a later one", async () => {
    const controller = new AbortController();
    const { service, saved } = setup({
      ai: true,
      pending: [vagueChannel("a"), vagueChannel("b"), vagueChannel("c"), vagueChannel("d")],
      respond: (call) => {
        if (call === 1) return { channels: [aiLabel("c1", "Minecraft"), aiLabel("c2", "Terraria")] };
        controller.abort();
        return new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
    });
    const result = await service.labelPending({ maxChannels: 10, now: () => NOW, signal: controller.signal });

    expect(result).toMatchObject({ labeled: 2, byAi: 2 });
    expect(saved.get("a")).toMatchObject({ nicheId: "niche-minecraft" });
    // The timed-out batch is left for the next run.
    expect(saved.has("c")).toBe(false);
  });

  it("keeps the rule labels when AI fails or skips a channel", async () => {
    const skipped = setup({ ai: true, pending: [vagueChannel("a"), vagueChannel("b")], respond: () => ({ channels: [aiLabel("c2", "   ")] }) });
    expect(await skipped.service.labelPending({ maxChannels: 10, now: () => NOW })).toMatchObject({ labeled: 2, byAi: 0 });
    // The AI saw it and couldn't place it either: don't send it again.
    expect(skipped.saved.get("a")).toMatchObject({ model: REVIEWED_MODEL });

    const broken = setup({ ai: true, pending: [vagueChannel("a")], respond: () => new AppError("UPSTREAM_ERROR", "bad json") });
    expect(await broken.service.labelPending({ maxChannels: 10, now: () => NOW })).toMatchObject({ labeled: 1, byAi: 0 });

    const misconfigured = setup({ ai: true, pending: [vagueChannel("a"), vagueChannel("b")], respond: () => new AppError("CONFIG_ERROR", "model retired") });
    expect(await misconfigured.service.labelPending({ maxChannels: 10, now: () => NOW })).toMatchObject({ labeled: 2, byAi: 0, batches: 1 });
    // A setup problem isn't a review either: fix the model and these get their AI look.
    expect(misconfigured.saved.get("a")).toMatchObject({ model: RULES_MODEL });

    const down = setup({ ai: true, pending: [vagueChannel("a"), vagueChannel("b"), vagueChannel("c")], respond: () => new Error("529 overloaded") });
    expect(await down.service.labelPending({ maxChannels: 10, now: () => NOW })).toMatchObject({ labeled: 3, byAi: 0, batches: 1 });
    // An outage isn't a review: these stay eligible for the next run.
    expect(down.saved.get("a")).toMatchObject({ model: RULES_MODEL });
  });
});
