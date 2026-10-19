import { describe, expect, it } from "vitest";
import { VOICE_CHARACTERS_EVENT, VOICE_CREDITS_EVENT, VOICE_MAX_CHARACTERS, VoiceService, cleanSettings, voiceResetLabel } from "@/lib/services/voice-service";
import { DEFAULT_VOICE_SETTINGS, type VoiceSettings } from "@/lib/voice/elevenlabs";

const now = new Date("2026-10-19T12:00:00Z");
const voices = [{ id: "v1", name: "Roger", gender: "male", accent: "american", age: "middle aged", tone: "classy", useCase: "conversational", previewUrl: null }];

function setup(opts: { used?: number; cap?: number; userUsed?: number } = {}) {
  const spoken: { voiceId: string; text: string; settings: VoiceSettings | undefined }[] = [];
  const recorded: { event_type: string; quantity?: number; user_id?: string | null }[] = [];
  const windows: Date[] = [];
  const userWindows: Date[] = [];
  const service = new VoiceService({
    client: {
      model: "eleven_v4_turbo",
      listVoices: async () => voices,
      speak: async (voiceId, text, settings) => {
        spoken.push({ voiceId, text, settings });
        return { audio: new Uint8Array([1, 2, 3]), credits: 5 };
      },
    },
    usage: {
      countSince: async (_type, since) => {
        windows.push(since);
        return opts.used ?? 0;
      },
      userCountSince: async (_userId, _type, since) => {
        userWindows.push(since);
        return opts.userUsed ?? 0;
      },
      record: async (event) => {
        recorded.push(event);
        return event as never;
      },
    },
    creditCap: opts.cap ?? 60_000,
  });
  return { service, spoken, recorded, windows, userWindows };
}

describe("VoiceService", () => {
  it("reads the text out with the chosen settings and records the credits ElevenLabs charged", async () => {
    const { service, spoken, recorded } = setup();
    const settings = { stability: 0.3, style: 0.2, speed: 1.1 };
    const result = await service.speak("u1", "  Your redstone\n is wrong.  ", "v1", settings, null, now);
    expect(result.audio).toEqual(new Uint8Array([1, 2, 3]));
    expect(spoken[0]).toEqual({ voiceId: "v1", text: "Your redstone is wrong.", settings });
    expect(recorded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: VOICE_CHARACTERS_EVENT, user_id: "u1", quantity: 23 }),
        expect.objectContaining({ event_type: VOICE_CREDITS_EVENT, user_id: "u1", quantity: 5 }),
      ]),
    );
  });

  it("turns away empty and over-long text before calling ElevenLabs", async () => {
    const { service, spoken } = setup();
    await expect(service.speak("u1", "   ", "v1", DEFAULT_VOICE_SETTINGS, null, now)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(service.speak("u1", "a".repeat(VOICE_MAX_CHARACTERS + 1), "v1", DEFAULT_VOICE_SETTINGS, null, now)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(spoken).toHaveLength(0);
  });

  it("only uses stock voices from the list", async () => {
    const { service } = setup();
    await expect(service.speak("u1", "Hi there.", "cloned-voice", DEFAULT_VOICE_SETTINGS, null, now)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("stops at the cap on credits over the last 30 days", async () => {
    const { service, spoken, windows } = setup({ used: 59_998 });
    await expect(service.speak("u1", "Ten chars.", "v1", DEFAULT_VOICE_SETTINGS, null, now)).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    expect(windows[0]).toEqual(new Date("2026-09-19T12:00:00Z"));
    expect(spoken).toHaveLength(0);
  });

  it("counts each person's characters from the 1st of the month", async () => {
    const { service, spoken, userWindows } = setup({ userUsed: 9_990 });
    await service.speak("u1", "Ten chars.", "v1", DEFAULT_VOICE_SETTINGS, 10_000, now);
    expect(userWindows[0]).toEqual(new Date("2026-10-01T00:00:00Z"));
    expect(spoken).toHaveLength(1);
  });

  it("turns away text longer than what's left of the allowance, before calling ElevenLabs", async () => {
    const { service, spoken, recorded } = setup({ userUsed: 9_995 });
    await expect(service.speak("u1", "Ten chars.", "v1", DEFAULT_VOICE_SETTINGS, 10_000, now)).rejects.toMatchObject({ code: "QUOTA_EXCEEDED", message: expect.stringContaining("5 left") });
    expect(spoken).toHaveLength(0);
    expect(recorded).toHaveLength(0);
  });

  it("gives no allowance limit to the owner", async () => {
    const { service, spoken, userWindows } = setup({ userUsed: 1_000_000 });
    await service.speak("owner", "Ten chars.", "v1", DEFAULT_VOICE_SETTINGS, null, now);
    expect(spoken).toHaveLength(1);
    expect(userWindows).toHaveLength(0);
  });

  it("says when the allowance resets", () => {
    expect(voiceResetLabel(now)).toBe("Nov 1");
    expect(voiceResetLabel(new Date("2026-12-31T23:00:00Z"))).toBe("Jan 1");
  });

  it("is off without a key", async () => {
    const service = new VoiceService({ client: null, usage: { countSince: async () => 0, userCountSince: async () => 0, record: async () => ({}) as never }, creditCap: 1_000 });
    expect(service.enabled).toBe(false);
    expect(await service.voices()).toEqual([]);
  });
});

describe("cleanSettings", () => {
  it("keeps settings in the ranges ElevenLabs accepts", () => {
    expect(cleanSettings({ stability: 2, style: -1, speed: 5 })).toEqual({ stability: 1, style: 0, speed: 1.2 });
    expect(cleanSettings({ stability: "x", speed: undefined })).toEqual(DEFAULT_VOICE_SETTINGS);
  });
});
