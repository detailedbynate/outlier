import type { DiscoverFormat } from "./discover";
import { categoryFor } from "./revenue";
import { gameIn } from "./rule-labeler";

/**
 * What the Niche Finder starts on for one creator, from their onboarding
 * answers: the format they make, gaming or everything, and the games they
 * named so those come first. Anything set in the URL still wins.
 */
export interface NichePreferences {
  format: DiscoverFormat | null;
  lens: "gaming" | "all" | null;
  /** Games the creator named, under the names the library uses. */
  games: string[];
}

export function nichePreferences(prefs: { contentFormats: string[]; niches: string[] } | null): NichePreferences {
  if (!prefs) return { format: null, lens: null, games: [] };
  const formats = new Set(prefs.contentFormats);
  const format = formats.size === 1 ? (formats.has("long_form") ? "long_form" : formats.has("shorts") ? "shorts" : null) : null;
  const games = [...new Set(prefs.niches.map((n) => gameIn(n)).filter((g): g is string => !!g))];
  const categories = prefs.niches.map((n) => categoryFor(n));
  // Only a creator who named topics and none of them games starts on all niches.
  const lens = prefs.niches.length === 0 ? null : games.length > 0 || categories.includes("Gaming") ? "gaming" : categories.some(Boolean) ? "all" : null;
  return { format, lens, games };
}

/** The creator's own games first, in their original order; the rest after. */
export function mineFirst<T>(items: readonly T[], mine: readonly string[], nameOf: (item: T) => string | null): T[] {
  if (mine.length === 0) return [...items];
  const wanted = new Set(mine);
  const isMine = (item: T) => {
    const name = nameOf(item);
    return name !== null && wanted.has(name);
  };
  return [...items.filter(isMine), ...items.filter((i) => !isMine(i))];
}
