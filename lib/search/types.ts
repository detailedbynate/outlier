import type { ChannelRow, VideoRow } from "@/types/database";

/**
 * Catalog search & similarity abstractions.
 *
 * Planned implementation path (all free/local):
 *  1. Keyword search over channels/videos using the pg_trgm indexes already in the schema.
 *  2. Semantic similarity with pgvector: embed channel title+description+keywords
 *     (lib/ai EmbeddingProvider) into an `embedding vector(n)` column, query by cosine distance.
 */

export interface CatalogSearchQuery {
  text: string;
  nicheId?: string;
  minSubscribers?: number;
  maxSubscribers?: number;
  country?: string;
  limit?: number;
  offset?: number;
}

export interface ScoredResult<T> {
  item: T;
  /** Higher is more relevant; comparable only within one result set. */
  score: number;
}

export interface ChannelSearchProvider {
  searchChannels(query: CatalogSearchQuery): Promise<ScoredResult<ChannelRow>[]>;
}

export interface VideoSearchProvider {
  searchVideos(query: CatalogSearchQuery & { format?: VideoRow["format"]; publishedAfter?: string }): Promise<ScoredResult<VideoRow>[]>;
}

export interface SimilarityProvider {
  /** Channels most similar to the given catalog channel. */
  similarChannels(channelId: string, limit: number): Promise<ScoredResult<ChannelRow>[]>;
  /** (Re)compute and store the embedding for a channel. */
  indexChannel(channelId: string): Promise<void>;
}
