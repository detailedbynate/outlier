import { describe, expect, it, vi } from "vitest";
import { isAppError } from "@/lib/core/errors";
import { scriptSystemPrompt, scriptUserPrompt } from "@/lib/scripts/prompt";
import { ScriptService } from "@/lib/services/script-service";

const script = {
  script: "This cost me four hundred quid to learn.\nThe part everyone replaces first is almost never the broken one.\nCheck the sensor before you touch the pump.",
  titles: ["The £400 mistake", "Don't replace this first"],
};

function serviceWith(deps: Record<string, unknown> = {}) {
  const generateObject = vi.fn().mockResolvedValue({ object: script, model: "test-model", usage: { inputTokens: 0, outputTokens: 0 } });
  const service = new ScriptService({
    ai: { name: "test", generateText: vi.fn(), generateObject } as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    ...deps,
  });
  return { service, generateObject };
}

describe("ScriptService", () => {
  it("returns the script and counts its spoken words", async () => {
    const { service } = serviceWith();
    const result = await service.write({ topic: "car detailing", idea: "an idea" });

    expect(result.script.script).toContain("four hundred quid");
    expect(result.script.titles).toHaveLength(2);
    expect(result.words).toBe(27);
    expect(result.model).toBe("test-model");
  });

  it("asks for a niche and an idea", async () => {
    const { service } = serviceWith();
    await expect(service.write({ topic: "  ", idea: "something" })).rejects.toThrow(/niche/i);
    await expect(service.write({ topic: "cars", idea: " " })).rejects.toThrow(/about/i);
  });

  it("says so plainly when no AI provider is configured", async () => {
    const { service } = serviceWith({ ai: null });
    const error = await service.write({ topic: "cars", idea: "an idea" }).catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("CONFIG_ERROR");
  });

  it("never looks anything up, so a script isn't waiting on the library", async () => {
    // The old writer fetched the niche's outliers and their transcripts first,
    // which cost a minute or two and taught it to write about titles.
    const { service, generateObject } = serviceWith();
    await service.write({ topic: "minecraft", idea: "redstone without repeaters" });

    const prompt = generateObject.mock.calls[0]![0].messages[0].content as string;
    expect(prompt).toContain("minecraft");
    expect(prompt).not.toMatch(/its channel's usual views|opens on:/);
  });
});

describe("script prompt", () => {
  it("scales the word budget to the requested length", () => {
    expect(scriptUserPrompt({ topic: "fishing", idea: "an idea", targetSeconds: 15 })).toContain("33 spoken words");
    expect(scriptUserPrompt({ topic: "fishing", idea: "an idea", targetSeconds: 60 })).toContain("132 spoken words");
  });

  it("tells it to build on the creator's own material when there is some", () => {
    const withAngle = scriptUserPrompt({ topic: "fishing", idea: "an idea", angle: "I fish the same river every week" });
    expect(withAngle).toContain("I fish the same river every week");
    expect(withAngle).toContain("Build the script around this");
    expect(scriptUserPrompt({ topic: "fishing", idea: "an idea" })).not.toContain("Build the script around this");
  });

  it("teaches a layout and shows it, rather than hoping the model has one", () => {
    const system = scriptSystemPrompt();
    for (const beat of ["HOOK", "TURN", "BODY", "PAYOFF", "LANDING"]) expect(system).toContain(beat);
    // Two worked examples, from different niches, so it copies shape not subject.
    expect(system).toContain("niche: home coffee");
    expect(system).toContain("niche: long distance running");
  });

  it("forbids the invention that made the early scripts untrustworthy", () => {
    expect(scriptSystemPrompt()).toMatch(/Do not invent facts, statistics/);
  });
});
