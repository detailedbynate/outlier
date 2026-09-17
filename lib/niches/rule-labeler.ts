/**
 * Free, deterministic niche labeling. No AI and no API key: a channel is matched
 * against the dictionary of known games and topics by how many of its recent
 * uploads mention each one, with YouTube's own topic categories as a fallback for
 * the category. Channels outside the dictionary get their most repeated upload
 * phrase as a topic, at lower confidence.
 */

import { tokenize } from "./analysis";
import { isClipChannel } from "./focus";
import { NICHE_DICTIONARY, type DictionaryEntry } from "./dictionary";
import { nicheSlug, topicName, type ChannelLabel, type ContentFormat, type NicheCategory, type QualityFlag } from "./labeling";

export const RULES_MODEL = "rules-v1";

export interface RuleLabelInput {
  title: string;
  description: string | null;
  keywords: string[];
  topicCategories: string[];
  uploads: { title: string; tags: string[] }[];
}

/** Lowercase, accents and punctuation removed, single spaces: "Pokémon GO!" -> "pokemon go". */
export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

interface CompiledEntry {
  entry: DictionaryEntry;
  phrases: string[];
}

const COMPILED: CompiledEntry[] = NICHE_DICTIONARY.map((entry) => {
  const base = entry.aliasesOnly ? [] : [entry.name];
  const phrases = [...base, ...entry.aliases].map(normalizeText).filter((p) => p.length >= 2);
  // "#clashroyale" is written without spaces.
  for (const phrase of [...phrases]) {
    const compact = phrase.replace(/ /g, "");
    if (compact !== phrase && compact.length >= 6) phrases.push(compact);
  }
  return { entry, phrases: [...new Set(phrases)] };
});

const contains = (haystack: string, phrase: string) => haystack.includes(` ${phrase} `);
const padded = (value: string) => ` ${normalizeText(value)} `;

/** Share of uploads a niche must show up in before it counts as the channel's niche. */
const MIN_UPLOAD_SHARE = 0.3;
/** Below this confidence a label is worth a second opinion (from AI, when one is configured). */
export const CONFIDENT = 0.6;

interface Match {
  entry: DictionaryEntry;
  share: number;
  inName: boolean;
  inProfile: boolean;
  longestPhrase: number;
  score: number;
}

function matchDictionary(input: RuleLabelInput): Match[] {
  const uploads = input.uploads.map((u) => padded(`${u.title} ${u.tags.join(" ")}`));
  const name = padded(input.title);
  const profile = padded(`${input.keywords.join(" ")} ${input.description ?? ""}`);
  const matches: Match[] = [];

  for (const { entry, phrases } of COMPILED) {
    let hits = 0;
    let longestPhrase = 0;
    for (const upload of uploads) {
      const found = phrases.filter((phrase) => contains(upload, phrase));
      if (found.length === 0) continue;
      hits += 1;
      longestPhrase = Math.max(longestPhrase, ...found.map((p) => p.length));
    }
    const inName = phrases.some((phrase) => contains(name, phrase));
    const inProfile = phrases.some((phrase) => contains(profile, phrase));
    if (hits === 0 && !inName) continue;

    const share = uploads.length > 0 ? hits / uploads.length : 0;
    const score = share * 0.7 + (inName ? 0.25 : 0) + (inProfile ? 0.1 : 0);
    matches.push({ entry, share, inName, inProfile, longestPhrase, score });
  }
  return matches.sort((a, b) => b.score - a.score);
}

/**
 * The most specific strong match: "Blox Fruits" over "Roblox", "Pokémon GO" over
 * "Pokémon", when the specific one covers most of what the broad one does.
 */
function pickPrimary(matches: Match[]): Match | null {
  const qualified = matches.filter((m) => m.share >= MIN_UPLOAD_SHARE || (m.inName && m.share >= 0.1));
  if (qualified.length === 0) return null;
  let best = qualified[0]!;
  for (const candidate of qualified.slice(1)) {
    const inside = candidate.entry.within === best.entry.name;
    const narrower = candidate.longestPhrase > best.longestPhrase && candidate.entry.category === best.entry.category;
    if ((inside || narrower) && candidate.share >= best.share * 0.6) best = candidate;
  }
  return best;
}

/** YouTube topic categories, for the category when nothing in the dictionary matched. */
const TOPIC_CATEGORY_RULES: [RegExp, NicheCategory][] = [
  [/game|gaming|esports/i, "Gaming"],
  [/food|cuisine|cooking|recipe/i, "Food & Cooking"],
  [/fitness|health|sport of athletics|bodybuilding|yoga/i, "Fitness & Health"],
  [/music|hip hop|pop music|rock music|song|dance/i, "Music & Dance"],
  [/pet|animal|dog|cat/i, "Animals & Pets"],
  [/vehicle|automobile|motorcycle|car/i, "Cars & Vehicles"],
  [/technology|computer|science|electronics/i, "Science & Tech"],
  [/knowledge|education|history|philosophy/i, "Education & Explainers"],
  [/humour|humor|comedy/i, "Comedy & Skits"],
  [/film|television|entertainment|anime|celebrity/i, "Entertainment & Pop Culture"],
  [/football|basketball|baseball|golf|boxing|mixed martial|wrestling|tennis|motorsport|sport/i, "Sports"],
  [/fashion|beauty|physical attractiveness|cosmetics/i, "Beauty & Fashion"],
  [/tourism|travel|hiking|outdoor/i, "Travel & Outdoors"],
  [/business|finance|economics|investment/i, "Finance & Business"],
  [/politics|society|news/i, "News & Commentary"],
  [/hobby|diy|craft|home improvement|gardening/i, "DIY, Crafts & Home"],
  [/lifestyle/i, "Lifestyle & Vlogs"],
];

function categoryFromTopics(topicCategories: string[]): NicheCategory | null {
  const names = topicCategories.map(topicName);
  for (const [pattern, category] of TOPIC_CATEGORY_RULES) {
    if (names.some((name) => pattern.test(name))) return category;
  }
  return null;
}

const FORMAT_RULES: [RegExp, ContentFormat][] = [
  [/\btier list\b|\branking\b|\branked\b|\bbest to worst\b/, "tier_list_ranking"],
  [/\bhow to\b|\bguide\b|\btutorial\b|\btips\b|\btricks\b|\bbeginner/, "tutorial_guide"],
  [/\breact(s|ing|ion)?\b/, "reaction"],
  [/\breview\b|\bunboxing\b|\bworth it\b/, "review"],
  [/\bfacts?\b|\bexplained\b|\bwhy\b|\bhistory of\b/, "facts_explainer"],
  [/\bchallenge\b|\bi tried\b|\bsurviv/, "challenge"],
  [/\bcompilation\b|\bbest moments\b|\bfunny moments\b|\bclips?\b/, "compilation_clips"],
  [/\basmr\b|\bsatisfying\b/, "satisfying_asmr"],
  [/\bvlog\b|\bday in (my|the) life\b|\bmorning routine\b/, "vlog"],
  [/\bnews\b|\bupdate\b|\bleaks?\b|\bpatch\b/, "news_update"],
  [/\bedit\b|\bmemes?\b/, "meme_edit"],
  [/\bgameplay\b|\bplaythrough\b|\blet ?s play\b|\bwalkthrough\b|\bspeedrun\b/, "gameplay"],
  [/\bpodcast\b|\binterview\b/, "podcast_interview"],
  [/\banimat(ion|ed)\b/, "animation"],
  [/\bskit\b|\bpov\b|\bstorytime\b|\bwhen your\b/, "skit_story"],
];

function formatsFor(uploads: RuleLabelInput["uploads"]): ContentFormat[] {
  const counts = new Map<ContentFormat, number>();
  for (const upload of uploads) {
    const text = normalizeText(upload.title);
    for (const [pattern, format] of FORMAT_RULES) if (pattern.test(text)) counts.set(format, (counts.get(format) ?? 0) + 1);
  }
  const needed = Math.max(2, Math.ceil(uploads.length * 0.2));
  return [...counts.entries()]
    .filter(([, n]) => n >= needed)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([format]) => format);
}

const REUPLOAD_NOTICE = /(all rights (belong|go|reserved) to|no copyright infringement|i do not own|credit(s)? (goes|go) to|not my (video|content)|copyright disclaimer|fair use)/i;
const COMPILATION_TITLE = /\b(compilation|best moments|funny moments|try not to laugh)\b/i;
const NON_LATIN = /[\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;

function flagsFor(input: RuleLabelInput): QualityFlag[] {
  const flags: QualityFlag[] = [];
  // Disclaimers in the description, or a channel YouTube files under television programs (TV/movie clips).
  if (REUPLOAD_NOTICE.test(input.description ?? "") || isClipChannel({ topicCategories: input.topicCategories, description: input.description })) flags.push("reupload");
  const titles = input.uploads.map((u) => u.title);
  if (titles.length >= 3 && titles.filter((t) => COMPILATION_TITLE.test(t)).length / titles.length >= 0.5) flags.push("compilation");
  if (titles.length >= 3 && titles.filter((t) => NON_LATIN.test(t)).length / titles.length >= 0.5) flags.push("non_english");
  return flags;
}

/** Repeated phrases in uploads, as sub-niches of the primary ("msm breeding combos"). */
/** Words that show up in upload titles and tags everywhere and never describe a niche. */
const NOISE = new Set(
  (
    "ytshorts youtubeshorts shortsfeed shortvideo viralvideo viralshorts viral trend trending trendingshorts fyp fypage foryou explore explorepage " +
    "funny funniest comedy memes meme humor lol omg wow crazy insane epic best better worst real fake found added coming meet makes sense " +
    "tips tricks trick hack hacks life lifehacks diy easy quick simple amazing beautiful satisfying tiny big size aura mais para como " +
    "part episode full live livestream stream video videos clip clips edit edits moment moments reaction reacts challenge vlog update news " +
    "new today week year day time people guy girl boy bro man woman kids family friend friends brother sister mom dad"
  ).split(" "),
);

function subNichesFor(input: RuleLabelInput, primaryName: string | null, primaryPhrases: string[]): string[] {
  // A channel's own name ("techno gamerz", "mkbhd") is not a niche.
  const nameWords = normalizeText(input.title).split(" ").filter((w) => w.length >= 3);
  const excluded = new Set([...primaryPhrases.flatMap((phrase) => phrase.split(" ")), ...nameWords, nameWords.join(""), ...NOISE]);
  const counts = new Map<string, number>();
  for (const upload of input.uploads) {
    const words = tokenize(`${upload.title} ${upload.tags.join(" ")}`)
      .map(normalizeText)
      .filter((word) => word && !excluded.has(word));
    const seen = new Set<string>();
    for (let i = 0; i < words.length; i++) {
      seen.add(words[i]!);
      if (i + 1 < words.length && words[i] !== words[i + 1]) seen.add(`${words[i]} ${words[i + 1]}`);
    }
    for (const term of seen) counts.set(term, (counts.get(term) ?? 0) + 1);
  }

  const needed = Math.max(2, Math.ceil(input.uploads.length * 0.15));
  const ranked = [...counts.entries()]
    .filter(([term, n]) => n >= needed && term.length >= 4)
    // Two-word phrases say more than the single words inside them.
    .sort((a, b) => b[1] * (b[0].includes(" ") ? 1.5 : 1) - a[1] * (a[0].includes(" ") ? 1.5 : 1) || a[0].localeCompare(b[0]));

  const chosen: string[] = [];
  for (const [term] of ranked) {
    if (chosen.length >= 5) break;
    const words = term.split(" ");
    if (chosen.some((c) => c.split(" ").some((w) => words.includes(w)))) continue;
    chosen.push(term);
  }
  const prefix = primaryName ? normalizeText(primaryName) : null;
  return chosen.map((term) => (prefix ? `${prefix} ${term}` : term));
}

/** A channel's most repeated phrase, for channels outside the dictionary. */
function inferTopic(input: RuleLabelInput): { name: string; share: number } | null {
  const [top] = subNichesFor(input, null, []);
  if (!top) return null;
  const hits = input.uploads.filter((u) => contains(padded(`${u.title} ${u.tags.join(" ")}`), top)).length;
  const share = input.uploads.length > 0 ? hits / input.uploads.length : 0;
  if (share < 0.4) return null;
  const name = top.replace(/\b\w/g, (c) => c.toUpperCase());
  return { name, share };
}

export interface RuleLabel extends Omit<ChannelLabel, "primary"> {
  primary: ChannelLabel["primary"] | null;
}

/** Label one channel. Always returns a category; the primary is null when nothing clear stands out. */
export function labelWithRules(input: RuleLabelInput): RuleLabel {
  const matches = matchDictionary(input);
  const primaryMatch = pickPrimary(matches);
  const formats = formatsFor(input.uploads);
  const flags = flagsFor(input);

  if (primaryMatch) {
    const { entry } = primaryMatch;
    const compiled = COMPILED.find((c) => c.entry === entry)!;
    // Strong coverage and a name or profile mention is as sure as rules get.
    // Showing up in 30% of uploads is the floor (0.48); two-thirds of uploads, or a name mention, is confident.
    let confidence = Math.min(0.95, 0.3 + primaryMatch.share * 0.6 + (primaryMatch.inName ? 0.15 : 0) + (primaryMatch.inProfile ? 0.05 : 0));
    // A news channel that often covers AI isn't an "AI Tools" channel: when YouTube's own
    // topics point somewhere else and the match isn't strong, trust the topics for the category.
    const topicCategory = categoryFromTopics(input.topicCategories);
    const contradicted = topicCategory !== null && topicCategory !== entry.category && confidence < 0.75;
    if (contradicted) confidence = Math.min(confidence, 0.5);
    return {
      category: contradicted ? topicCategory : entry.category,
      primary: {
        kind: entry.kind,
        name: entry.name,
        slug: nicheSlug(entry.name),
        aliases: entry.aliases.map(normalizeText).filter((a) => a !== normalizeText(entry.name)).slice(0, 10),
      },
      subNiches: subNichesFor(input, entry.name, compiled.phrases),
      formats,
      flags,
      confidence: Math.round(confidence * 100) / 100,
    };
  }

  const category = categoryFromTopics(input.topicCategories) ?? "Other";
  const inferred = inferTopic(input);
  if (inferred) {
    return {
      category,
      primary: { kind: "topic", name: inferred.name, slug: nicheSlug(inferred.name), aliases: [] },
      subNiches: subNichesFor(input, inferred.name, [normalizeText(inferred.name)]).slice(0, 3),
      formats,
      flags,
      // Unknown niches are guesses; keep them below the confident line.
      confidence: Math.round(Math.min(0.55, inferred.share * 0.6) * 100) / 100,
    };
  }

  return { category, primary: null, subNiches: subNichesFor(input, null, []).slice(0, 3), formats, flags, confidence: 0.2 };
}
