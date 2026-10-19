import { AppError } from "@/lib/core/errors";
import type { EmbeddingProvider } from "./types";

/**
 * OpenAI's small embedding model through OpenRouter: $0.02 per million tokens,
 * so the whole channel library (~400 tokens a channel) costs cents. Asked for
 * 256 dimensions, which the model supports natively (Matryoshka) with little
 * loss, so the vectors stay small in Postgres.
 */
export const EMBEDDING_MODEL = "openai/text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 256;

const ENDPOINT = "https://openrouter.ai/api/v1/embeddings";
/** Inputs per request; OpenAI takes up to 2,048, smaller batches fail cheaper. */
const BATCH = 100;

interface EmbeddingResponse {
  data?: { embedding: number[]; index: number }[];
  usage?: { prompt_tokens?: number; cost?: number };
  error?: { message?: string; code?: number };
}

export class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openrouter";
  readonly dimensions = EMBEDDING_DIMENSIONS;
  readonly model = EMBEDDING_MODEL;
  /** Tokens embedded since this provider was made, for the job's log line. */
  tokens = 0;

  constructor(
    private readonly options: { apiKey: string; fetch?: typeof fetch; signal?: AbortSignal },
  ) {}

  async embed(inputs: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < inputs.length; i += BATCH) out.push(...(await this.request(inputs.slice(i, i + BATCH))));
    return out;
  }

  private async request(input: string[]): Promise<number[][]> {
    if (input.length === 0) return [];
    const response = await (this.options.fetch ?? fetch)(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.options.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input, dimensions: EMBEDDING_DIMENSIONS }),
      signal: this.options.signal ?? AbortSignal.timeout(60_000),
    });
    const body = (await response.json().catch(() => ({}))) as EmbeddingResponse;
    if (!response.ok || !body.data) {
      throw new AppError("UPSTREAM_ERROR", `Embedding request failed (${response.status}): ${body.error?.message ?? "no data"}`, {
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    if (body.data.length !== input.length) throw new AppError("UPSTREAM_ERROR", "Embedding request returned the wrong number of vectors.", { retryable: true });
    this.tokens += body.usage?.prompt_tokens ?? 0;
    return [...body.data].sort((a, b) => a.index - b.index).map((d) => normalize(d.embedding));
  }
}

/** Unit length, so cosine similarity is a dot product and shortened vectors compare fairly. */
export function normalize(vector: number[]): number[] {
  const length = Math.hypot(...vector);
  return length > 0 ? vector.map((v) => v / length) : vector;
}
