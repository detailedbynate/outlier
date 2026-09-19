import { NICHE_DICTIONARY } from "./dictionary";

/**
 * Turning mined terms into names that read like niches.
 *
 * Sub-niches and underrated niches are mined from upload titles and tags, which
 * on its own produces things nobody would call a niche: "update", "lore", "cats",
 * "getting", or a hashtag run together as "reddeadredemption". Worse, a stripped
 * accent used to turn Pokémon into "Pok Mon".
 *
 * So a mined term has to earn its place: it is a niche if the dictionary knows
 * it, if a channel's own niche label says so, or if it reads like a name in the
 * titles it came from. Whatever survives is shown under its proper name.
 */

/** Lowercase, accent-free, single-spaced: "Pokémon GO!" -> "pokemon go". */
export function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Every name and alias the dictionary knows, mapped to the proper name. Hashtag spellings included. */
const BY_PHRASE = new Map<string, string>();
/** Single words to the dictionary names that contain them: "mario" -> Super Mario, "super" -> two names. */
const BY_WORD = new Map<string, Set<string>>();

for (const entry of NICHE_DICTIONARY) {
  const phrases = [entry.name, ...entry.aliases];
  for (const phrase of phrases) {
    const key = normalizeName(phrase);
    if (!key) continue;
    // First writer wins, so "pokemon" stays Pokémon rather than becoming Pokémon TCG.
    if (!BY_PHRASE.has(key)) BY_PHRASE.set(key, entry.name);
    // Hashtag spellings: "reddeadredemption2", and without the sequel number, "reddeadredemption".
    for (const squashed of [key.replace(/ /g, ""), key.replace(/ (?:\d+|ii|iii|iv|v|vi)$/, "").replace(/ /g, "")]) {
      if (squashed !== key && squashed.length >= 4 && !BY_PHRASE.has(squashed)) BY_PHRASE.set(squashed, entry.name);
    }
  }
  for (const word of normalizeName(entry.name).split(" ")) {
    if (word.length < 4) continue;
    const owners = BY_WORD.get(word) ?? new Set<string>();
    owners.add(entry.name);
    BY_WORD.set(word, owners);
  }
}

/**
 * The proper name for a mined term, or null when the dictionary doesn't know it.
 *
 * A single word that belongs to exactly one known name resolves to it ("mario"
 * is Super Mario). A word shared by several ("super") is a fragment, not a
 * niche, so it stays unknown and gets dropped.
 */
export function canonicalNiche(term: string): string | null {
  const key = normalizeName(term);
  if (!key) return null;
  const exact = BY_PHRASE.get(key) ?? BY_PHRASE.get(key.replace(/ /g, ""));
  if (exact) return exact;
  if (key.includes(" ")) return null;
  // A single word only stands for a name when it is long enough and distinctive
  // enough to mean it: "battle" belongs to The Battle Cats but is filler anywhere else.
  if (key.length < 4 || BROAD_TERMS.has(key)) return null;
  const owners = BY_WORD.get(key);
  return owners?.size === 1 ? [...owners][0]! : null;
}

const SMALL_WORDS = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "vs", "with"]);

/** Title case for terms the dictionary doesn't know: "funny moments" -> "Funny Moments". */
export function titleCaseNiche(term: string): string {
  const words = term.trim().split(/\s+/);
  return words
    .map((word, index) => (index > 0 && SMALL_WORDS.has(word.toLowerCase()) ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

/** The spelling used to collapse "arthurmorgan" and "arthur morgan" into one niche. */
export function nicheKey(term: string): string {
  return (canonicalNiche(term) ?? normalizeName(term)).replace(/ /g, "").toLowerCase();
}

/** What a mined term should be called on screen. */
export function displayNicheName(term: string): string {
  return canonicalNiche(term) ?? titleCaseNiche(term);
}

/**
 * Does this single word read like a name in the titles it came from?
 *
 * "Backrooms" and "Shadowheart" are capitalized wherever they appear; "update"
 * and "funny" are not. The first word of a title is ignored, since everything is
 * capitalized there.
 *
 * Some creators write every title in lower case, where capitalization says
 * nothing either way. Rather than throw away every niche on such channels, an
 * unhelpful sample counts as a pass and the other rules decide.
 */
export function readsLikeAName(word: string, titles: readonly string[], minShare = 0.6): boolean {
  if (!titlesUseCapitals(titles)) return true;
  let seen = 0;
  let capitalized = 0;
  const pattern = new RegExp(`(^|[^\\p{L}])(${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![\\p{L}])`, "giu");
  for (const title of titles) {
    // Compare on the accent-free form so "Pokémon" still matches "pokemon".
    const plain = title.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    for (const match of plain.matchAll(pattern)) {
      const at = match.index + match[1]!.length;
      // A word at the very start of a title says nothing about how it's written.
      if (at === 0) continue;
      seen += 1;
      if (/^\p{Lu}/u.test(match[2]!)) capitalized += 1;
    }
  }
  return seen >= 3 && capitalized / seen >= minShare;
}

/** Do these titles capitalize words at all? Answers whether the test above can mean anything. */
function titlesUseCapitals(titles: readonly string[], minShare = 0.15): boolean {
  let words = 0;
  let capitals = 0;
  for (const title of titles) {
    // The first word is capitalized in any style, so it is not evidence.
    for (const word of title.trim().split(/\s+/).slice(1)) {
      if (!/^\p{L}/u.test(word)) continue;
      words += 1;
      if (/^\p{Lu}/u.test(word)) capitals += 1;
    }
  }
  return words >= 5 && capitals / words >= minShare;
}

/** Words that describe half of YouTube, or a game's furniture, so they are never the niche itself. */
export const BROAD_TERMS = new Set(
  (
    "comedy funny meme memes real fake tips hacks diy craft crafts life hack asmr edit edits clips clip moment moments compilation reaction reactions " +
    "story storytime update updates news review reviews guide guides tutorial how tricks facts fact top best worst insane crazy amazing satisfying oddly " +
    "money rich poor kids family friends school work home food drink music song songs dance art drawing paint build building " +
    "process idea ideas thing things stuff part parts level levels mode modes collab collabs version episode series content creator creators " +
    // Words that fill gaming titles without naming anything: from real reports where they beat the actual niche.
    "lore playthrough walkthrough online offline fan fans secret secrets glitch boss fight battle win wins lose noob pro rank ranked " +
    "getting hilarious funniest simulation indie gameplay stream streamer highlights run runs lets play plays playing"
  ).split(/\s+/),
);

export interface NicheTermContext {
  /** Terms that came from channel niche labels: the dictionary or the AI already called these niches. */
  labeled?: ReadonlySet<string>;
  /** Titles the term was mined from, used to tell a name from an ordinary word. */
  titles?: readonly string[];
}

/**
 * A word that several known names share ("super", from Super Mario and Super
 * Smash Bros.) is a piece of a title, never a niche of its own — even when the
 * titles capitalize it.
 */
export function isSharedFragment(term: string): boolean {
  const key = normalizeName(term);
  if (key.includes(" ")) return false;
  return (BY_WORD.get(key)?.size ?? 0) > 1 && !BY_PHRASE.has(key);
}

/**
 * Is this mined term worth showing as a niche?
 *
 * Known niches and labeled terms pass. A phrase passes when none of its words is
 * filler. A bare word has to read like a name in its titles, which is what keeps
 * "Backrooms" and drops "update".
 */
export function isUsefulNiche(term: string, context: NicheTermContext = {}): boolean {
  const key = normalizeName(term);
  if (!key) return false;
  if (context.labeled?.has(term) || canonicalNiche(key)) return true;

  const words = key.split(" ");
  if (words.some((word) => BROAD_TERMS.has(word))) return false;
  if (isSharedFragment(key)) return false;
  // All fragments and no real word: "pok mon" is what a stripped accent used to
  // leave behind. "sea glass hunting" has a short word but is still a niche.
  if (words.every((word) => word.length < 4)) return false;
  // Verbs aren't topics: "getting", "stopped".
  if (words.every((word) => /(?:ed|ing)$/.test(word))) return false;

  if (words.length > 1) return true;
  const word = words[0]!;
  if (word.length < 4) return false;
  return context.titles ? readsLikeAName(word, context.titles) : false;
}
