import { createHash } from "node:crypto";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { EmbeddingRepository, EmbeddingSource } from "@/lib/database/repositories/embeddings";
import type { StorageBudgetService } from "./storage-budget-service";

/** Re-embed a channel this often: new uploads shift what it's about. Unchanged text costs nothing. */
const STALE_DAYS = 14;
/**
 * Measured on text-embedding-3-small at 256 dimensions with this text layout:
 * two channels in the same niche score ~0.88, the same broad category (two
 * gaming channels) ~0.65-0.70, unrelated ones ~0.58. Below this is noise.
 */
export const MIN_SIMILARITY = 0.6;
/** Similarity shown as 0% and 100%: the raw cosine range channels actually fall in. */
const MATCH_FLOOR = 0.5;
const MATCH_CEILING = 0.92;

export interface Embedder {
  readonly model: string;
  embed(inputs: string[]): Promise<number[][]>;
}

/**
 * The text a channel is compared by: who it says it is, what it's labeled as,
 * and what it has actually been uploading. Upload titles carry the most
 * weight in practice, since many descriptions are empty or a link list.
 */
export function embeddingText(source: EmbeddingSource): string {
  const lines = [
    `Channel: ${source.title}${source.handle ? ` (@${source.handle.replace(/^@/, "")})` : ""}`,
    source.niche_category || source.niche_labels.length > 0 ? `Niche: ${[source.niche_category, ...source.niche_labels].filter(Boolean).join(", ")}` : "",
    source.keywords.length > 0 ? `Keywords: ${source.keywords.slice(0, 20).join(", ")}` : "",
    source.description ? `About: ${source.description.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 500)}` : "",
    source.recent_titles.length > 0 ? `Recent videos:\n${source.recent_titles.map((t) => `- ${t.slice(0, 120)}`).join("\n")}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

const hashOf = (model: string, text: string) => createHash("sha256").update(`${model}\n${text}`).digest("hex").slice(0, 32);

/**
 * Similar channels, like Algrow's: every channel embedded once (and again when
 * its uploads change), then compared by cosine similarity in Postgres.
 */
export class SimilarChannelsService {
  private readonly log: Logger;

  constructor(
    private readonly deps: {
      embedder: Embedder | null;
      embeddings: EmbeddingRepository;
      storage?: Pick<StorageBudgetService, "assertCapacity">;
    },
  ) {
    this.log = createLogger({ module: "services.similar" });
  }

  get enabled(): boolean {
    return this.deps.embedder !== null;
  }

  /** Embed channels that have none yet, or whose embedding is old. For the hourly job. */
  async embedPending(options: { maxChannels: number; signal?: AbortSignal }, now: Date = new Date()): Promise<{ embedded: number; unchanged: number; skipped?: string }> {
    if (!this.deps.embedder) return { embedded: 0, unchanged: 0, skipped: "no OPENROUTER_API_KEY" };
    await this.deps.storage?.assertCapacity();
    const ids = await this.deps.embeddings.dueForEmbedding(options.maxChannels, new Date(now.getTime() - STALE_DAYS * 86_400_000));
    let embedded = 0;
    let unchanged = 0;
    // A few hundred at a time, so a failure part-way keeps what was already paid for.
    for (let i = 0; i < ids.length; i += 200) {
      if (options.signal?.aborted) break;
      const result = await this.embedChannels(ids.slice(i, i + 200), now);
      embedded += result.embedded;
      unchanged += result.unchanged;
    }
    this.log.info("channels embedded", { embedded, unchanged, due: ids.length });
    return { embedded, unchanged };
  }

  /** Embed these channels now, skipping any whose text hasn't changed. */
  async embedChannels(ids: string[], now: Date = new Date()): Promise<{ embedded: number; unchanged: number }> {
    const embedder = this.deps.embedder;
    if (!embedder || ids.length === 0) return { embedded: 0, unchanged: 0 };
    const [sources, hashes] = await Promise.all([this.deps.embeddings.sources(ids), this.deps.embeddings.hashes(ids)]);
    const items = sources.map((source) => {
      const text = embeddingText(source);
      return { channelId: source.channel_id, text, hash: hashOf(embedder.model, text) };
    });
    const same = items.filter((item) => hashes.get(item.channelId) === item.hash);
    const changed = items.filter((item) => hashes.get(item.channelId) !== item.hash);
    if (same.length > 0) await this.deps.embeddings.touch(same.map((s) => s.channelId), now);
    if (changed.length === 0) return { embedded: 0, unchanged: same.length };

    const vectors = await embedder.embed(changed.map((c) => c.text));
    await this.deps.embeddings.save(
      changed.map((c, index) => ({ channelId: c.channelId, embedding: vectors[index]!, model: embedder.model, sourceHash: c.hash })),
      now,
    );
    return { embedded: changed.length, unchanged: same.length };
  }

  /**
   * The channels most like this one, best first, as 0–1 similarity. A channel
   * that hasn't been embedded yet (just added) is embedded on the spot.
   */
  async similarTo(channelId: string, limit = 60): Promise<{ channelId: string; similarity: number }[]> {
    if (!this.deps.embedder) return [];
    if (!(await this.deps.embeddings.has(channelId))) await this.embedChannels([channelId]);
    const matches = await this.deps.embeddings.similar(channelId, limit);
    return matches.filter((m) => m.similarity >= MIN_SIMILARITY);
  }
}

/** Cosine similarity → the "83% match" badge, spread over the range channels really score in. */
export function matchPercent(similarity: number): number {
  const scaled = (similarity - MATCH_FLOOR) / (MATCH_CEILING - MATCH_FLOOR);
  return Math.round(Math.min(Math.max(scaled, 0), 1) * 100);
}
