/**
 * Keyword relevance for discovery. YouTube search happily returns big channels
 * that only brush against a niche, so a candidate has to actually mention what
 * was searched for before we add it.
 */

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "best", "but", "by", "channel", "channels", "for", "from", "how", "in", "is", "it", "my", "new", "of", "on",
  "or", "our", "short", "shorts", "the", "tips", "to", "top", "video", "videos", "vs", "with", "you", "your",
]);

/** Lowercased, punctuation stripped, so "My Singing Monsters!" matches "my singing monsters". */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The words a candidate must mention: the search minus filler, or the whole search if that's all filler. */
export function keywordTokens(query: string): string[] {
  const words = [...new Set(normalizeText(query).split(" ").filter(Boolean))];
  const meaningful = words.filter((word) => !STOPWORDS.has(word) && word.length >= 3);
  return meaningful.length > 0 ? meaningful : words;
}

/** True when every keyword appears somewhere in the text. */
export function mentionsKeywords(text: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const haystack = ` ${normalizeText(text)} `;
  return tokens.every((token) => haystack.includes(token));
}
