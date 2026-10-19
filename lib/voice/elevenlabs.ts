import { UpstreamError } from "@/lib/core/errors";

/**
 * The two ElevenLabs calls Outlier makes: which stock voices there are, and
 * turning a script into an MP3.
 *
 * Only ElevenLabs' own premade voices are offered. They're licensed for
 * commercial use on a paid plan, and they mean nobody can upload someone
 * else's voice to clone it.
 */

const BASE = "https://api.elevenlabs.io";

export interface Voice {
  id: string;
  name: string;
  /** "young, american, male" — from the voice's labels, for the picker. */
  description: string;
  /** A short sample ElevenLabs hosts, so a voice can be heard before spending anything. */
  previewUrl: string | null;
}

interface VoicesResponse {
  voices?: { voice_id: string; name: string; labels?: Record<string, string> | null; preview_url?: string | null }[];
}

export class ElevenLabsClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async listVoices(signal?: AbortSignal): Promise<Voice[]> {
    const response = await this.fetcher(`${BASE}/v2/voices?category=premade&page_size=100`, {
      headers: { "xi-api-key": this.apiKey },
      signal,
    });
    if (!response.ok) throw new UpstreamError("ElevenLabs", `couldn't list voices (${response.status})`, { expose: false });
    const body = (await response.json()) as VoicesResponse;
    return (body.voices ?? []).map((v) => ({
      id: v.voice_id,
      name: v.name.split(/\s+-\s+/)[0]!.trim(),
      description: describe(v.labels),
      previewUrl: v.preview_url ?? null,
    }));
  }

  /** The script read out, as MP3 bytes. */
  async speak(voiceId: string, text: string, signal?: AbortSignal): Promise<Uint8Array> {
    const response = await this.fetcher(`${BASE}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": this.apiKey, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: this.model }),
      signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new UpstreamError("ElevenLabs", `voice generation failed (${response.status}) ${detail.slice(0, 200)}`, { expose: false, retryable: response.status >= 500 });
    }
    return new Uint8Array(await response.arrayBuffer());
  }
}

function describe(labels: Record<string, string> | null | undefined): string {
  if (!labels) return "";
  return [labels.age, labels.accent, labels.gender, labels.description ?? labels.descriptive, labels.use_case ?? labels.use_cases]
    .filter((part): part is string => Boolean(part))
    .map((part) => part.replace(/_/g, " "))
    .join(", ");
}
