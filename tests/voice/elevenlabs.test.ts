import { describe, expect, it } from "vitest";
import { ElevenLabsClient } from "@/lib/voice/elevenlabs";

const voices = [
  { voice_id: "p1", name: "Roger - Laid-Back, Casual", category: "premade", labels: { gender: "male" } },
  { voice_id: "own1", name: "Nate", category: "cloned", sharing: null },
  { voice_id: "own2", name: "Nate", category: "professional", sharing: null },
  { voice_id: "lib1", name: "Jake – Deep, Smooth, Dramatic", category: "professional", sharing: { status: "copied" } },
  { voice_id: "lib2", name: "Calming Narrator", category: "professional", sharing: { status: "copied_disabled" } },
];

describe("ElevenLabsClient.listVoices", () => {
  it("offers stock and library voices, library first, never the account's own", async () => {
    const fetcher = (async () => new Response(JSON.stringify({ voices }))) as unknown as typeof fetch;
    const list = await new ElevenLabsClient("key", "eleven_v4", fetcher).listVoices();
    expect(list.map((v) => [v.id, v.name, v.library])).toEqual([
      ["lib1", "Jake", true],
      ["p1", "Roger", false],
    ]);
  });
});
