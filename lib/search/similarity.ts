import { ValidationError } from "@/lib/core/errors";

/** Cosine similarity in [-1, 1]. Returns 0 when either vector has zero magnitude. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new ValidationError(`Vector length mismatch: ${a.length} vs ${b.length}`);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Jaccard similarity of two keyword/tag sets (case-insensitive) — a cheap pre-embedding similarity signal. */
export function jaccardSimilarity(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a.map((s) => s.toLowerCase().trim()).filter(Boolean));
  const setB = new Set(b.map((s) => s.toLowerCase().trim()).filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) if (setB.has(item)) intersection++;
  return intersection / (setA.size + setB.size - intersection);
}

/** Return the top-k items by score, descending. */
export function topK<T>(items: readonly T[], score: (item: T) => number, k: number): { item: T; score: number }[] {
  return items
    .map((item) => ({ item, score: score(item) }))
    .toSorted((x, y) => y.score - x.score)
    .slice(0, Math.max(k, 0));
}
