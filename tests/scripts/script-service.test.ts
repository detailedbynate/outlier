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
    saved: { save: vi.fn().mockResolvedValue({ id: "saved-1" }), listForUser: vi.fn(), delete: vi.fn() } as never,
    styles: { listForUser: vi.fn().mockResolvedValue([]) } as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    ...deps,
  });
  return { service, generateObject };
}

describe("ScriptService", () => {
  it("uses the premium writer only when asked, and the standard one otherwise", async () => {
    const premium = vi.fn().mockResolvedValue({ object: script, model: "premium-model", usage: {} });
    const { service, generateObject } = serviceWith({ premiumAi: { name: "premium", generateText: vi.fn(), generateObject: premium } });

    expect((await service.write({ topic: "fishing", idea: "an idea" }, undefined, { premium: true })).model).toBe("premium-model");
    expect((await service.write({ topic: "fishing", idea: "an idea" })).model).toBe("test-model");
    expect(premium).toHaveBeenCalledTimes(1);
    expect(generateObject).toHaveBeenCalledTimes(1);
  });

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
    expect(scriptUserPrompt({ topic: "fishing", idea: "an idea", targetSeconds: 15 })).toContain("42 spoken words");
    expect(scriptUserPrompt({ topic: "fishing", idea: "an idea", targetSeconds: 25 })).toContain("70 spoken words");
  });

  it("gives a hard ceiling, because the target alone got overrun by half", () => {
    // Claude wrote 96 words for a 30 second slot when only told the target.
    const prompt = scriptUserPrompt({ topic: "fishing", idea: "an idea", targetSeconds: 30 });
    expect(prompt).toContain("84 spoken words");
    expect(prompt).toContain("92 is the hard maximum");
    expect(prompt).toMatch(/cut whole sentences/);
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

describe("honesty rules", () => {
  it("won't let it guess what's in an update it can't know about", () => {
    const prompt = scriptUserPrompt({ topic: "My Singing Monsters", idea: "The new Blizzard Island update" });
    expect(prompt).toMatch(/newer than your knowledge/);
    expect(prompt).toMatch(/Do not guess at its contents/);
  });

  it("treats what they said about an update as the only source", () => {
    const prompt = scriptUserPrompt({ topic: "My Singing Monsters", idea: "The new Blizzard Island update", angle: "it adds three ice monsters" });
    expect(prompt).toMatch(/only source for what is new/);
  });

  it("leaves evergreen ideas alone", () => {
    expect(scriptUserPrompt({ topic: "fishing", idea: "why your knots slip" })).not.toMatch(/newer than your knowledge/);
  });

  it("shows its examples as prose, since a model copies an example's layout over a rule", () => {
    // Each example is one quoted paragraph on the line after its heading.
    const examples = [...scriptSystemPrompt().matchAll(/^Example — .*\n"([^\n]*)/gm)].map((m) => m[1]!);
    expect(examples).toHaveLength(2);
    for (const example of examples) expect(example).toMatch(/"$/);
  });

  it("doesn't model an invented first-person claim in its own examples", () => {
    expect(scriptSystemPrompt()).not.toMatch(/"I ran my/);
  });

  it("forbids inventing the creator's own life, not just facts in general", () => {
    // nemotron wrote "My emergency fund was $500" for someone who never said that.
    const system = scriptSystemPrompt();
    expect(system).toMatch(/Never invent the creator's own life/);
    expect(system).toMatch(/lying to their audience/);
  });
});

describe("learning a voice from their own scripts", () => {
  const sample = (word: string) => `${word} `.repeat(20).trim();

  it("keeps the built-in examples until there are enough samples", () => {
    expect(scriptSystemPrompt([])).toContain("niche: home coffee");
    // One script is as likely to be an off day as a style.
    expect(scriptSystemPrompt([sample("alpha")])).toContain("niche: home coffee");
  });

  it("replaces the built-in examples once there are two", () => {
    const system = scriptSystemPrompt([sample("alpha"), sample("beta")]);
    expect(system).toContain("This is the voice to write in");
    expect(system).toContain("alpha");
    // Both voices in one prompt makes the model split the difference.
    expect(system).not.toContain("niche: home coffee");
  });

  it("uses at most three, so samples can't crowd out the instructions", () => {
    const system = scriptSystemPrompt([sample("one"), sample("two"), sample("three"), sample("four")]);
    expect(system).toContain("Their script 3:");
    expect(system).not.toContain("Their script 4:");
    expect(system).not.toContain("four");
  });

  it("ignores a scrap too short to show a style", () => {
    expect(scriptSystemPrompt([sample("alpha"), "too short"])).toContain("niche: home coffee");
  });

  it("trims a pasted long-form transcript rather than sending the whole thing", () => {
    const system = scriptSystemPrompt([sample("alpha"), "x".repeat(5000)]);
    expect(system).toContain("…");
    expect(system).not.toContain("x".repeat(2100));
  });

  it("still forbids inventing facts even when copying their style", () => {
    const system = scriptSystemPrompt([sample("alpha"), sample("beta")]);
    expect(system).toMatch(/except on inventing facts, which is never allowed/);
  });
});
