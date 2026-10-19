import { describe, expect, it } from "vitest";
import { VOICE_CHARACTERS_EVENT, VoiceService } from "@/lib/services/voice-service";
import type { SavedScriptRow } from "@/types/database";

const now = new Date("2026-10-19T12:00:00Z");
const voices = [{ id: "v1", name: "Adam", description: "middle aged, american, male", previewUrl: null }];

function setup(opts: { used?: number; monthly?: number; script?: string | null } = {}) {
  const spoken: { voiceId: string; text: string }[] = [];
  const recorded: { event_type: string; quantity?: number; user_id?: string | null }[] = [];
  const row = opts.script === null ? null : ({ id: "s1", user_id: "u1", script: opts.script ?? "Your redstone is wrong.Here is why." } as SavedScriptRow);
  const service = new VoiceService({
    client: {
      listVoices: async () => voices,
      speak: async (voiceId, text) => {
        spoken.push({ voiceId, text });
        return new Uint8Array([1, 2, 3]);
      },
    },
    scripts: { getForUser: async (userId, id) => (userId === "u1" && id === "s1" ? row : null) },
    usage: {
      countSince: async () => opts.used ?? 0,
      record: async (event) => {
        recorded.push(event);
        return event as never;
      },
    },
    monthlyCharacters: opts.monthly ?? 1_000_000,
  });
  return { service, spoken, recorded };
}

describe("VoiceService", () => {
  it("reads out the saved script, cleaned up, and counts the characters", async () => {
    const { service, spoken, recorded } = setup();
    const result = await service.voiceover("u1", "s1", "v1", now);
    expect(result.audio).toEqual(new Uint8Array([1, 2, 3]));
    expect(spoken[0]).toEqual({ voiceId: "v1", text: "Your redstone is wrong. Here is why." });
    expect(recorded[0]).toMatchObject({ event_type: VOICE_CHARACTERS_EVENT, user_id: "u1", quantity: 36 });
  });

  it("only voices the person's own scripts", async () => {
    const { service, spoken } = setup();
    await expect(service.voiceover("someone-else", "s1", "v1", now)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(spoken).toHaveLength(0);
  });

  it("only uses stock voices from the list", async () => {
    const { service } = setup();
    await expect(service.voiceover("u1", "s1", "cloned-voice", now)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("stops at the monthly character cap", async () => {
    const { service, spoken } = setup({ used: 999_990 });
    await expect(service.voiceover("u1", "s1", "v1", now)).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    expect(spoken).toHaveLength(0);
  });

  it("is off without a key", async () => {
    const service = new VoiceService({ client: null, scripts: { getForUser: async () => null }, usage: { countSince: async () => 0, record: async () => ({}) as never }, monthlyCharacters: 1_000 });
    expect(service.enabled).toBe(false);
    expect(await service.voices()).toEqual([]);
  });
});
