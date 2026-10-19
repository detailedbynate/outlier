import { describe, expect, it } from "vitest";
import { VOICE_CREDITS_EVENT, VOICE_MAX_CHARACTERS, VoiceService, cleanSettings } from "@/lib/services/voice-service";
import { DEFAULT_VOICE_SETTINGS, type VoiceSettings } from "@/lib/voice/elevenlabs";

const now = new Date("2026-10-19T12:00:00Z");
const voices = [{ id: "v1", name: "Roger", gender: "male", accent: "american", age: "middle aged", tone: "classy", useCase: "conversational", previewUrl: null }];

function setup(opts: { used?: number; cap?: number } = {}) {
  const spoken: { voiceId: string; text: string; settings: VoiceSettings | undefined }[] = [];
  const recorded: { event_type: string; quantity?: number; user_id?: string | null }[] = [];
  const windows: Date[] = [];
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
      record: async (event) => {
        recorded.push(event);
        return event as never;
      },
    },
    creditCap: opts.cap ?? 60_000,
  });
  return { service, spoken, recorded, windows };
}

describe("VoiceService", () => {
  it("reads the text out with the chosen settings and records the credits ElevenLabs charged", async () => {
    const { service, spoken, recorded } = setup();
    const settings = { stability: 0.3, style: 0.2, speed: 1.1 };
    const result = await service.speak("u1", "  Your redstone\n is wrong.  ", "v1", settings, now);
    expect(result.audio).toEqual(new Uint8Array([1, 2, 3]));
    expect(spoken[0]).toEqual({ voiceId: "v1", text: "Your redstone is wrong.", settings });
    expect(recorded[0]).toMatchObject({ event_type: VOICE_CREDITS_EVENT, user_id: "u1", quantity: 5 });
  });

  it("turns away empty and over-long text before calling ElevenLabs", async () => {
    const { service, spoken } = setup();
    await expect(service.speak("u1", "   ", "v1", DEFAULT_VOICE_SETTINGS, now)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(service.speak("u1", "a".repeat(VOICE_MAX_CHARACTERS + 1), "v1", DEFAULT_VOICE_SETTINGS, now)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(spoken).toHaveLength(0);
  });

  it("only uses stock voices from the list", async () => {
    const { service } = setup();
    await expect(service.speak("u1", "Hi there.", "cloned-voice", DEFAULT_VOICE_SETTINGS, now)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("stops at the cap on credits over the last 30 days", async () => {
    const { service, spoken, windows } = setup({ used: 59_998 });
    await expect(service.speak("u1", "Ten chars.", "v1", DEFAULT_VOICE_SETTINGS, now)).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    expect(windows[0]).toEqual(new Date("2026-09-19T12:00:00Z"));
    expect(spoken).toHaveLength(0);
  });

  it("is off without a key", async () => {
    const service = new VoiceService({ client: null, usage: { countSince: async () => 0, record: async () => ({}) as never }, creditCap: 1_000 });
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
