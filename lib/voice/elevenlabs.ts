import { UpstreamError } from "@/lib/core/errors";

/**
 * The two ElevenLabs calls Outlier makes: which stock voices there are, and
 * turning text into an MP3.
 *
 * Only ElevenLabs' own premade voices are offered. They're licensed for
 * commercial use on a paid plan, and they mean nobody can upload someone
 * else's voice to clone it.
 */

const BASE = "https://api.elevenlabs.io";

export interface Voice {
  id: string;
  name: string;
  gender: string | null;
  accent: string | null;
  age: string | null;
  /** "classy", "hyped", "sassy" — how it sounds. */
  tone: string | null;
  /** "conversational", "social media" — what it's made for. */
  useCase: string | null;
  /** A short sample ElevenLabs hosts, so a voice can be heard before spending anything. */
  previewUrl: string | null;
}

/** How it's read. Each 0–1 except speed (0.7–1.2, 1 is normal). */
export interface VoiceSettings {
  /** Low is more expressive and varied, high is steadier. */
  stability: number;
  /** How much the voice leans into its own character. */
  style: number;
  speed: number;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = { stability: 0.5, style: 0, speed: 1 };

interface VoicesResponse {
  voices?: { voice_id: string; name: string; labels?: Record<string, string> | null; preview_url?: string | null }[];
}

export class ElevenLabsClient {
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async listVoices(signal?: AbortSignal): Promise<Voice[]> {
    const response = await this.fetcher(`${BASE}/v2/voices?category=premade&page_size=100`, {
      headers: { "xi-api-key": this.apiKey },
      signal,
    });
    if (!response.ok) throw new UpstreamError("ElevenLabs", `couldn't list voices (${response.status})`, { expose: false });
    const body = (await response.json()) as VoicesResponse;
    return (body.voices ?? []).map((v) => {
      const labels = v.labels ?? {};
      return {
        id: v.voice_id,
        // Premade names come as "Roger - Laid-Back, Casual"; the part before the dash is the name.
        name: v.name.split(/\s+-\s+/)[0]!.trim(),
        gender: label(labels.gender),
        accent: label(labels.accent),
        age: label(labels.age),
        tone: label(labels.descriptive ?? labels.description),
        useCase: label(labels.use_case ?? labels.use_cases),
        previewUrl: v.preview_url ?? null,
      };
    });
  }

  /** The text read out, as MP3 bytes, and the credits ElevenLabs says it cost (null if it didn't say). */
  async speak(voiceId: string, text: string, settings: VoiceSettings = DEFAULT_VOICE_SETTINGS, signal?: AbortSignal): Promise<{ audio: Uint8Array; credits: number | null }> {
    const response = await this.fetcher(`${BASE}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": this.apiKey, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: this.model, voice_settings: settings }),
      signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new UpstreamError("ElevenLabs", `voice generation failed (${response.status}) ${detail.slice(0, 200)}`, { expose: false, retryable: response.status >= 500 });
    }
    const credits = Number(response.headers.get("character-cost"));
    return { audio: new Uint8Array(await response.arrayBuffer()), credits: Number.isFinite(credits) && credits > 0 ? credits : null };
  }
}

/** What the studio calls the model it's using. */
export function modelLabel(modelId: string): { name: string; note: string } {
  const known: Record<string, { name: string; note: string }> = {
    eleven_v4_turbo: { name: "Eleven v4 Turbo", note: "Fast, natural and expressive" },
    eleven_v4: { name: "Eleven v4", note: "The most lifelike and expressive" },
    eleven_flash_v2_5: { name: "Eleven Flash v2.5", note: "Fast and natural" },
    eleven_multilingual_v2: { name: "Eleven Multilingual v2", note: "Steady and consistent" },
  };
  return known[modelId] ?? { name: modelId, note: "ElevenLabs" };
}

function label(value: string | undefined): string | null {
  return value ? value.replace(/_/g, " ") : null;
}
