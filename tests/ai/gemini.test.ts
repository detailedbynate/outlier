import { ApiError } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GeminiTextProvider, jsonSchemaFor } from "@/lib/ai/gemini";
import { labelingProvider } from "@/lib/ai/select";
import { isAppError } from "@/lib/core/errors";

function fakeClient(response: Record<string, unknown> | Error) {
  const generateContent = vi.fn(async (_params: Record<string, unknown>) => {
    if (response instanceof Error) throw response;
    return {
      text: "",
      modelVersion: "gemini-2.5-flash",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 80 },
      ...response,
    };
  });
  return { client: { models: { generateContent } } as never, generateContent };
}

const schema = z.object({ channels: z.array(z.object({ ref: z.string(), name: z.string() })) });

describe("GeminiTextProvider", () => {
  it("asks for JSON matching the schema and validates the answer", async () => {
    const { client, generateContent } = fakeClient({ text: '{"channels":[{"ref":"c1","name":"Clash Royale"}]}' });
    const result = await new GeminiTextProvider({ client, model: "gemini-2.5-flash" }).generateObject({
      system: "Label channels.",
      messages: [{ role: "user", content: "c1: clash tips" }],
      schema,
      schemaName: "labels",
      maxOutputTokens: 4_000,
    });

    expect(result).toEqual({ object: { channels: [{ ref: "c1", name: "Clash Royale" }] }, model: "gemini-2.5-flash", usage: { inputTokens: 300, outputTokens: 80 } });
    const params = generateContent.mock.calls[0]![0] as { model: string; contents: unknown; config: Record<string, unknown> };
    expect(params.model).toBe("gemini-2.5-flash");
    expect(params.contents).toEqual([{ role: "user", parts: [{ text: "c1: clash tips" }] }]);
    expect(params.config).toMatchObject({ systemInstruction: "Label channels.", maxOutputTokens: 4_000, responseMimeType: "application/json" });
    expect(params.config.responseJsonSchema).toEqual(jsonSchemaFor(schema));
  });

  it("builds a schema Gemini accepts", () => {
    const json = jsonSchemaFor(schema);
    expect(json).not.toHaveProperty("$schema");
    expect(json).toMatchObject({ type: "object", required: ["channels"] });
  });

  it("rejects output that isn't valid JSON or doesn't fit the schema", async () => {
    const bad = fakeClient({ text: "sorry" });
    await expect(new GeminiTextProvider({ client: bad.client }).generateObject({ messages: [{ role: "user", content: "x" }], schema, schemaName: "labels" })).rejects.toThrow(/invalid JSON/);
    const wrong = fakeClient({ text: '{"channels":[{"ref":1}]}' });
    await expect(new GeminiTextProvider({ client: wrong.client }).generateObject({ messages: [{ role: "user", content: "x" }], schema, schemaName: "labels" })).rejects.toThrow(/didn't match/);
  });

  it("treats blocked or cut-off answers as unusable, but lets rate limits through untouched", async () => {
    const blocked = fakeClient({ candidates: [{ finishReason: "SAFETY" }] });
    const blockedError = await new GeminiTextProvider({ client: blocked.client }).generateText({ messages: [{ role: "user", content: "x" }] }).catch((e: unknown) => e);
    expect(isAppError(blockedError) && blockedError.retryable).toBe(false);

    const limited = fakeClient(new ApiError({ message: "quota", status: 429 }));
    const limitedError = await new GeminiTextProvider({ client: limited.client }).generateText({ messages: [{ role: "user", content: "x" }] }).catch((e: unknown) => e);
    // Not an AppError: the labeling job stops for this run and retries later.
    expect(isAppError(limitedError)).toBe(false);

    const badKey = fakeClient(new ApiError({ message: "bad key", status: 400 }));
    await expect(new GeminiTextProvider({ client: badKey.client }).generateText({ messages: [{ role: "user", content: "x" }] })).rejects.toMatchObject({ code: "CONFIG_ERROR" });
  });
});

describe("labelingProvider", () => {
  const base = { NICHE_LABEL_PROVIDER: "auto" as const, GEMINI_MODEL: "gemini-2.5-flash", NICHE_LABEL_MODEL: "claude-opus-5" };

  it("prefers free Gemini (backed by OpenRouter when both are set), then Claude, then rules only", () => {
    expect(labelingProvider({ ...base, GEMINI_API_KEY: "g", OPENROUTER_API_KEY: "o", ANTHROPIC_API_KEY: "a" })?.name).toBe("gemini+openrouter");
    expect(labelingProvider({ ...base, OPENROUTER_API_KEY: "o", ANTHROPIC_API_KEY: "a" })?.name).toBe("openrouter");
    expect(labelingProvider({ ...base, GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" })?.name).toBe("gemini");
    expect(labelingProvider({ ...base, ANTHROPIC_API_KEY: "a" })?.name).toBe("anthropic");
    expect(labelingProvider(base)).toBeNull();
  });

  it("follows an explicit choice", () => {
    expect(labelingProvider({ ...base, NICHE_LABEL_PROVIDER: "anthropic", GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" })?.name).toBe("anthropic");
    expect(labelingProvider({ ...base, NICHE_LABEL_PROVIDER: "gemini", ANTHROPIC_API_KEY: "a" })).toBeNull();
    expect(labelingProvider({ ...base, NICHE_LABEL_PROVIDER: "rules", GEMINI_API_KEY: "g" })).toBeNull();
  });
});
