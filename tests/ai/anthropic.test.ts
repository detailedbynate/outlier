import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AnthropicTextProvider } from "@/lib/ai/anthropic";
import { isAppError } from "@/lib/core/errors";

function fakeClient(response: Record<string, unknown>) {
  const create = vi.fn(async (_params: Record<string, unknown>, _options?: unknown) => ({
    model: "claude-opus-5",
    stop_reason: "end_turn",
    stop_details: null,
    usage: { input_tokens: 120, output_tokens: 30 },
    content: [],
    ...response,
  }));
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
}

const schema = z.object({ channels: z.array(z.object({ ref: z.string(), name: z.string() })) });

describe("AnthropicTextProvider", () => {
  it("sends a cached system prompt, refusal fallbacks and effort, and parses the structured answer", async () => {
    const { client, create } = fakeClient({ content: [{ type: "text", text: '{"channels":[{"ref":"c1","name":"Clash Royale"}]}' }] });
    const provider = new AnthropicTextProvider({ client, model: "claude-opus-5" });

    const result = await provider.generateObject({
      system: "Label channels.",
      messages: [{ role: "user", content: "c1: Clash tips" }],
      schema,
      schemaName: "labels",
      effort: "low",
      maxOutputTokens: 2_000,
    });

    expect(result).toEqual({ object: { channels: [{ ref: "c1", name: "Clash Royale" }] }, model: "claude-opus-5", usage: { inputTokens: 120, outputTokens: 30 } });
    const params = create.mock.calls[0]![0];
    expect(params).toMatchObject({
      model: "claude-opus-5",
      max_tokens: 2_000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: "Label channels.", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "c1: Clash tips" }],
    });
    expect((params.output_config as { effort: string; format: { type: string } }).effort).toBe("low");
    expect((params.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    // Current models reject sampling parameters.
    expect(params).not.toHaveProperty("temperature");
  });

  it("leaves out settings a cheaper model would reject", async () => {
    const { client, create } = fakeClient({ content: [{ type: "text", text: '{"channels":[]}' }] });
    await new AnthropicTextProvider({ client, model: "claude-haiku-4-5" }).generateObject({
      messages: [{ role: "user", content: "x" }],
      schema,
      schemaName: "labels",
      effort: "low",
    });
    const params = create.mock.calls[0]![0];
    expect(params.model).toBe("claude-haiku-4-5");
    expect(params).not.toHaveProperty("fallbacks");
    expect(params).not.toHaveProperty("betas");
    expect(params.output_config).not.toHaveProperty("effort");
    expect(params.output_config).toHaveProperty("format");
  });

  it("raises a non-retryable error when the model declines", async () => {
    const { client } = fakeClient({ stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: null } });
    const error = await new AnthropicTextProvider({ client }).generateText({ messages: [{ role: "user", content: "hi" }] }).catch((e: unknown) => e);
    expect(isAppError(error) && error.retryable).toBe(false);
  });

  it("raises when the output isn't valid JSON or doesn't match the schema", async () => {
    const bad = fakeClient({ content: [{ type: "text", text: "not json" }] });
    await expect(new AnthropicTextProvider({ client: bad.client }).generateObject({ messages: [{ role: "user", content: "x" }], schema, schemaName: "labels" })).rejects.toThrow(/invalid JSON/);

    const wrong = fakeClient({ content: [{ type: "text", text: '{"channels":[{"ref":1}]}' }] });
    await expect(new AnthropicTextProvider({ client: wrong.client }).generateObject({ messages: [{ role: "user", content: "x" }], schema, schemaName: "labels" })).rejects.toThrow(/didn't match/);
  });

  it("joins text blocks and reports the stop reason for plain text", async () => {
    const { client } = fakeClient({ content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Hello " }, { type: "text", text: "there" }] });
    expect(await new AnthropicTextProvider({ client }).generateText({ messages: [{ role: "user", content: "hi" }] })).toMatchObject({ text: "Hello there", stopReason: "end_turn" });
  });
});
