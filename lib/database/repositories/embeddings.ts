import type { DatabaseClient } from "@/lib/database/client";
import { assertOk, unwrap } from "@/lib/database/errors";
import type { Database } from "@/types/database";

export type EmbeddingSource = Database["public"]["Functions"]["channel_embedding_sources"]["Returns"][number];

/** Hundreds of ids in one filter overflow the request URL limit. */
const IDS_PER_REQUEST = 100;

/** Channel embeddings for similar-channel search (supabase/migrations/20261019000039_channel_embeddings.sql). */
export class EmbeddingRepository {
  constructor(private readonly db: DatabaseClient) {}

  /** Channels never embedded, or embedded before `staleBefore`, biggest first. */
  async dueForEmbedding(limit: number, staleBefore: Date): Promise<string[]> {
    return unwrap(await this.db.rpc("channels_to_embed", { batch_size: limit, stale_before: staleBefore.toISOString() }), "embeddings.due");
  }

  async sources(ids: string[], titlesPerChannel = 20): Promise<EmbeddingSource[]> {
    const rows: EmbeddingSource[] = [];
    for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) {
      rows.push(...unwrap(await this.db.rpc("channel_embedding_sources", { ids: ids.slice(i, i + IDS_PER_REQUEST), titles_per_channel: titlesPerChannel }), "embeddings.sources"));
    }
    return rows;
  }

  /** The source hash each channel was last embedded from. */
  async hashes(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) {
      const rows = unwrap(
        await this.db.from("channel_embeddings").select("channel_id, source_hash").in("channel_id", ids.slice(i, i + IDS_PER_REQUEST)),
        "embeddings.hashes",
      );
      for (const row of rows) out.set(row.channel_id, row.source_hash);
    }
    return out;
  }

  async save(rows: { channelId: string; embedding: number[]; model: string; sourceHash: string }[], at: Date): Promise<void> {
    if (rows.length === 0) return;
    assertOk(
      await this.db.from("channel_embeddings").upsert(
        rows.map((r) => ({
          channel_id: r.channelId,
          // pgvector reads the text form; four decimals is plenty for a half-precision column.
          embedding: `[${r.embedding.map((v) => v.toFixed(5)).join(",")}]`,
          model: r.model,
          source_hash: r.sourceHash,
          embedded_at: at.toISOString(),
        })),
        { onConflict: "channel_id" },
      ),
      "embeddings.save",
    );
  }

  /** Nothing to re-embed: mark them fresh so the queue moves on. */
  async touch(ids: string[], at: Date): Promise<void> {
    for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) {
      assertOk(await this.db.from("channel_embeddings").update({ embedded_at: at.toISOString() }).in("channel_id", ids.slice(i, i + IDS_PER_REQUEST)), "embeddings.touch");
    }
  }

  async has(channelId: string): Promise<boolean> {
    const rows = unwrap(await this.db.from("channel_embeddings").select("channel_id").eq("channel_id", channelId).limit(1), "embeddings.has");
    return rows.length > 0;
  }

  async count(): Promise<number> {
    const result = await this.db.from("channel_embeddings").select("channel_id", { count: "exact", head: true });
    assertOk(result, "embeddings.count");
    return result.count ?? 0;
  }

  /** The channels closest to `channelId`, with similarity from 0 to 1. */
  async similar(channelId: string, limit: number): Promise<{ channelId: string; similarity: number }[]> {
    const rows = unwrap(await this.db.rpc("match_similar_channels", { target: channelId, match_count: limit }), "embeddings.similar");
    return rows.map((r) => ({ channelId: r.channel_id, similarity: Number(r.similarity) }));
  }
}
