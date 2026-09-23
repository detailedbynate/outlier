import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { FallbackTextProvider } from "@/lib/ai/fallback";
import { extractJson, MAX_OPENROUTER_MODELS, OpenRouterTextProvider, OpenRouterUnavailableError } from "@/lib/ai/openrouter";
import type { TextProvider } from "@/lib/ai/types";
import { isAppError } from "@/lib/core/errors";

const schema = z.object({ queries: z.array(z.string()) });
const request = { messages: [{ role: "user" as const, content: "stoicism" }], schema, schemaName: "plan" };

function reply(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("OpenRouterTextProvider", () => {

  it("sends at most three models, because OpenRouter 400s on a longer list", async () => {
    const seen: string[][] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string; models?: string[] };
      seen.push(body.models ?? [body.model]);
      return new Response(JSON.stringify({ model: body.model, choices: [{ message: { content: "hi" } }] }), { status: 200 });
    });
    const provider = new OpenRouterTextProvider({
      apiKey: "k",
      models: ["a:free", "b:free", "c:free", "d:free", "e:free"],
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await provider.generateText({ messages: [{ role: "user", content: "hello" }] });

    // The routing array is what OpenRouter counts, and "d"/"e" must not reach it.
    expect(seen[0]).toEqual(["a:free", "b:free", "c:free"]);
    expect(seen[0]!.length).toBeLessThanOrEqual(MAX_OPENROUTER_MODELS);
  });
  it("sends the schema and model fallbacks, and validates the answer", async () => {
    const fetch = reply(200, { model: "qwen/qwen3.8-27b:free", choices: [{ message: { content: '{"queries":["stoic philosophy"]}' }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 8 } });
    const provider = new OpenRouterTextProvider({ apiKey: "k", models: ["a:free", "b:free"], fetch });
    const result = await provider.generateObject({ ...request, maxOutputTokens: 1_000, effort: "low" });
    expect(result).toEqual({ object: { queries: ["stoic philosophy"] }, model: "qwen/qwen3.8-27b:free", usage: { inputTokens: 12, outputTokens: 8 } });

    const init = fetch.mock.calls[0]![1]!;
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: "a:free",
      models: ["a:free", "b:free"],
      response_format: { type: "json_schema", json_schema: { name: "plan", strict: true } },
      // Reasoning stays short and out of the answer, with room left for it.
      reasoning: { effort: "low", exclude: true },
      max_tokens: 3_000,
    });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
  });

  it("tries the next model when one answers with nothing", async () => {
    const empty = { model: "a:free", choices: [{ message: { content: "" }, finish_reason: "stop" }] };
    const good = { model: "b:free", choices: [{ message: { content: '{"queries":["x"]}' }, finish_reason: "stop" }] };
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(empty))).mockResolvedValueOnce(new Response(JSON.stringify(good)));
    const provider = new OpenRouterTextProvider({ apiKey: "k", models: ["a:free", "b:free"], fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(provider.generateObject(request)).resolves.toMatchObject({ object: { queries: ["x"] }, model: "b:free" });
    expect(JSON.parse(fetch.mock.calls[1]![1]!.body as string).model).toBe("b:free");
  });

  it("accepts JSON wrapped in a code fence", async () => {
    const fence = "`".repeat(3);
    const fetch = reply(200, { choices: [{ message: { content: `${fence}json\n{"queries":["x"]}\n${fence}` }, finish_reason: "stop" }] });
    await expect(new OpenRouterTextProvider({ apiKey: "k", fetch }).generateObject(request)).resolves.toMatchObject({ object: { queries: ["x"] } });
  });

  it("treats rate limits as unavailable and bad requests as setup errors", async () => {
    const limited = await new OpenRouterTextProvider({ apiKey: "k", fetch: reply(429, { error: { code: 429, message: "slow down" } }) })
      .generateObject(request)
      .catch((e: unknown) => e);
    expect(limited).toBeInstanceOf(OpenRouterUnavailableError);
    expect(isAppError(limited)).toBe(false);

    await expect(new OpenRouterTextProvider({ apiKey: "k", fetch: reply(401, { error: { code: 401, message: "no key" } }) }).generateObject(request)).rejects.toMatchObject({
      code: "CONFIG_ERROR",
    });
  });

  it("rejects answers that don't match the schema", async () => {
    const fetch = reply(200, { choices: [{ message: { content: '{"nope":1}' }, finish_reason: "stop" }] });
    await expect(new OpenRouterTextProvider({ apiKey: "k", fetch }).generateObject(request)).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
  });
});

describe("FallbackTextProvider", () => {
  const provider = (name: string, generateObject: TextProvider["generateObject"]) => ({ name, generateText: vi.fn(), generateObject }) as unknown as TextProvider;

  it("moves to the next provider when one fails", async () => {
    const first = provider("gemini", vi.fn(async () => Promise.reject(new Error("429"))));
    const second = provider("openrouter", vi.fn(async () => ({ object: { queries: ["y"] }, model: "m", usage: { inputTokens: 0, outputTokens: 0 } })) as never);
    const chain = new FallbackTextProvider([first, second]);
    expect(chain.name).toBe("gemini+openrouter");
    await expect(chain.generateObject(request)).resolves.toMatchObject({ object: { queries: ["y"] } });
  });

  it("throws the last error when every provider fails", async () => {
    const boom = new OpenRouterUnavailableError(429, "all busy");
    const chain = new FallbackTextProvider([provider("a", vi.fn(async () => Promise.reject(new Error("first")))), provider("b", vi.fn(async () => Promise.reject(boom)))]);
    await expect(chain.generateObject(request)).rejects.toBe(boom);
  });
});

describe("extractJson", () => {
  const fence = "`".repeat(3);
  it.each([
    ["plain", '{"a":1}'],
    ["fenced", `${fence}json\n{"a":1}\n${fence}`],
    ["a preamble first", 'Here are the labels:\n{"a":1}'],
    ["thinking left in", '<think>they want labels</think>\n{"a":1}'],
    ["a fence halfway down", `Sure.\n${fence}json\n{"a":1}\n${fence}\nHope that helps!`],
    ["trailing commentary", '{"a":1}\n\nLet me know if you need more.'],
  ])("finds the JSON with %s", (_name, reply) => {
    expect(JSON.parse(extractJson(reply))).toEqual({ a: 1 });
  });
});
