/**
 * YouTube autocomplete: what people actually type into the search box. Free,
 * one light request per prefix, and the order of the suggestions is a demand
 * signal on its own (the first suggestion is searched more than the tenth).
 */

export interface Suggestion {
  phrase: string;
  /** 0 = first suggestion. */
  rank: number;
}

const SUGGEST_URL = "https://suggestqueries.google.com/complete/search";

/** Clean a phrase the way keywords are stored: lowercase, single spaces, no stray punctuation. */
export function normalizeKeyword(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'&+#.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The `client=firefox` answer: `[query, [suggestions...], ...]`. */
export function parseSuggestions(body: unknown): Suggestion[] {
  if (!Array.isArray(body) || !Array.isArray(body[1])) return [];
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  (body[1] as unknown[]).forEach((value, rank) => {
    if (typeof value !== "string") return;
    const phrase = normalizeKeyword(value);
    if (phrase.length < 3 || phrase.length > 80 || seen.has(phrase)) return;
    seen.add(phrase);
    out.push({ phrase, rank });
  });
  return out;
}

/**
 * The prefixes worth asking about a phrase. Seeds get the full alphabet sweep
 * ("credit card a", "credit card b"...), which is where the long tail lives;
 * deeper phrases get a few question and intent prefixes so the tree stays
 * bounded.
 */
export function expansionQueries(keyword: string, depth: number): string[] {
  const base = [keyword];
  const questions = [`how to ${keyword}`, `why ${keyword}`, `${keyword} for`, `${keyword} vs`, `best ${keyword}`];
  if (depth === 0) {
    const letters = "abcdefghijklmnopqrstuvwxyz".split("").map((l) => `${keyword} ${l}`);
    return [...base, ...questions, ...letters];
  }
  if (depth === 1) return [...base, ...questions.slice(0, 3)];
  return base;
}

/** Phrases that are a person, a single video or noise rather than a topic to build a channel on. */
const JUNK = /\b(lyrics|song|full movie|full episode|trailer|live stream|livestream|reaction|meme|tiktok|instagram|login|sign in|near me|\d{4,})\b/;

/**
 * Phrases aimed at lower-RPM markets: Hindi/Urdu written in Latin letters, and
 * banks, apps and currencies that only exist there. Autocomplete serves them even
 * with a US region, and scoring them at US rates would rank them far too high.
 */
const OTHER_MARKET =
  /\b(kaise|kare|karen|kya|hai|hain|kaun|kitna|mein|wala|wale|kese|kab|aur|bhai|sbi|hdfc|icici|idfc|axis bank|kotak|paytm|phonepe|upi|rupees?|lakh|crore|bpi|gcash|bdo|metrobank|nigeria|naira|ghana|kenya|pakistan|bangladesh|tamil|telugu|malayalam|kannada|hindi|urdu|bangla|marathi|gujarati|tagalog)\b/;

export function isUsefulPhrase(phrase: string, parent: string): boolean {
  if (phrase === parent) return false;
  if (JUNK.test(phrase) || OTHER_MARKET.test(phrase)) return false;
  const words = phrase.split(" ");
  return words.length >= 2 && words.length <= 7;
}

export interface SuggestOptions {
  lang?: string;
  region?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

export async function fetchSuggestions(query: string, options: SuggestOptions = {}): Promise<Suggestion[]> {
  const url = new URL(SUGGEST_URL);
  url.searchParams.set("client", "firefox");
  url.searchParams.set("ds", "yt");
  url.searchParams.set("hl", options.lang ?? "en");
  url.searchParams.set("gl", (options.region ?? "us").toLowerCase());
  url.searchParams.set("q", query);
  const response = await (options.fetch ?? fetch)(url, {
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0" },
    signal: options.signal ?? AbortSignal.timeout(10_000),
  });
  if (response.status === 429 || response.status === 403) throw new Error(`autocomplete refused (${response.status}): rate limited`);
  if (!response.ok) throw new Error(`autocomplete failed (${response.status})`);
  // The endpoint answers in the page's legacy charset; JSON.parse of the text handles UTF-8 fine.
  return parseSuggestions(JSON.parse(await response.text()));
}
