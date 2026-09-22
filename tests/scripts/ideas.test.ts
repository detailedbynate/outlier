import { describe, expect, it, vi } from "vitest";
import { ideaSystemPrompt, ideaUserPrompt } from "@/lib/scripts/ideas";
import { ScriptService } from "@/lib/services/script-service";
import { isAppError } from "@/lib/core/errors";

const ideas = {
  ideas: [
    { title: "Why your piston door jams", hook: "Your piston door isn't broken.", why: "Names a fault most builders blame on the door." },
    { title: "Stop using repeaters here", hook: "Half your repeaters do nothing.", why: "Challenges a habit every tutorial teaches." },
    { title: "The tick nobody counts", hook: "One tick is why it fails.", why: "A specific cause with a specific fix." },
  ],
};

function serviceWith(over: Record<string, unknown> = {}) {
  const generateObject = vi.fn().mockResolvedValue({ object: ideas, model: "test-model", usage: {} });
  const saved = { listForUser: vi.fn().mockResolvedValue([]), save: vi.fn(), delete: vi.fn() };
  const styles = { listForUser: vi.fn().mockResolvedValue([]) };
  const service = new ScriptService({
    ai: { name: "test", generateText: vi.fn(), generateObject } as never,
    saved: saved as never,
    styles: styles as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    ...over,
  });
  return { service, generateObject, saved, styles };
}

describe("ScriptService.ideas", () => {
  it("returns ideas for a niche", async () => {
    const { service } = serviceWith();
    const result = await service.ideas("minecraft redstone");
    expect(result.ideas).toHaveLength(3);
    expect(result.model).toBe("test-model");
  });

  it("tells the model what they've already made, so nothing comes back twice", async () => {
    const { service, generateObject, saved } = serviceWith();
    saved.listForUser.mockResolvedValue([{ idea: "why your piston door jams", titles: ["Piston doors, explained"] }]);

    await service.ideas("minecraft", "owner-1");

    const prompt = generateObject.mock.calls[0]![0].messages[0].content as string;
    expect(prompt).toContain("Do not suggest any of them again");
    expect(prompt).toContain("why your piston door jams");
    expect(prompt).toContain("Piston doors, explained");
  });

  it("still suggests ideas when the history can't be read", async () => {
    const { service, saved } = serviceWith();
    saved.listForUser.mockRejectedValue(new Error("database down"));
    // Ideas without the history are still ideas; they just might repeat one.
    expect((await service.ideas("minecraft", "owner-1")).ideas).toHaveLength(3);
  });

  it("asks for a niche", async () => {
    const { service } = serviceWith();
    await expect(service.ideas("   ")).rejects.toThrow(/niche/i);
  });

  it("says so plainly when no AI provider is configured", async () => {
    const { service } = serviceWith({ ai: null });
    const error = await service.ideas("minecraft").catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("CONFIG_ERROR");
  });
});

describe("idea prompt", () => {
  it("wants one specific thing, not a topic", () => {
    expect(ideaSystemPrompt()).toMatch(/"Redstone" is a topic/);
  });

  it("forbids inventing detail to make an idea sound good", () => {
    expect(ideaSystemPrompt()).toMatch(/Inventing facts, numbers, versions, prices or events/);
  });

  it("shows their own scripts so ideas land at the level they work at", () => {
    const prompt = ideaUserPrompt({ topic: "fishing", alreadyMade: [], samples: ["I fish the same river every week and it taught me this."] });
    expect(prompt).toContain("I fish the same river every week");
  });

  it("leaves the history out entirely when there isn't any", () => {
    const prompt = ideaUserPrompt({ topic: "fishing", alreadyMade: [], samples: [] });
    expect(prompt).not.toContain("Do not suggest any of them again");
    expect(prompt).not.toContain("so you can see the level they pitch at");
  });
});
