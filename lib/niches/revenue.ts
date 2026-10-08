import { NICHE_DICTIONARY } from "./dictionary";
import type { NicheCategory } from "./labeling";
import { normalizeName } from "./naming";

/**
 * Rough YouTube earnings for a niche. RPM is what a creator keeps per 1,000
 * views after YouTube's cut, and it swings with the audience's country, the
 * season and how many views are monetized, so everything here is a range: a
 * ballpark for comparing niches, never a promise.
 */

type Range = [low: number, high: number];

interface RpmBand {
  long: Range;
  shorts: Range;
}

/** Typical creator RPM in USD by category, from public creator reports. */
const RPM_BY_CATEGORY: Partial<Record<NicheCategory, RpmBand>> = {
  "Finance & Business": { long: [8, 20], shorts: [0.08, 0.25] },
  "Science & Tech": { long: [4, 10], shorts: [0.06, 0.15] },
  "Education & Explainers": { long: [3, 8], shorts: [0.05, 0.12] },
  "Fitness & Health": { long: [3, 7], shorts: [0.05, 0.1] },
  "Cars & Vehicles": { long: [3, 7], shorts: [0.04, 0.1] },
  "Beauty & Fashion": { long: [2, 6], shorts: [0.04, 0.09] },
  "Travel & Outdoors": { long: [2, 6], shorts: [0.04, 0.09] },
  "Food & Cooking": { long: [2, 5], shorts: [0.03, 0.08] },
  "DIY, Crafts & Home": { long: [2, 5], shorts: [0.03, 0.08] },
  "Lifestyle & Vlogs": { long: [2, 5], shorts: [0.03, 0.07] },
  Sports: { long: [1.5, 4], shorts: [0.03, 0.07] },
  Gaming: { long: [1, 4], shorts: [0.02, 0.06] },
  "Animals & Pets": { long: [1, 3], shorts: [0.02, 0.06] },
  "Entertainment & Pop Culture": { long: [1, 3.5], shorts: [0.02, 0.06] },
  "Comedy & Skits": { long: [1, 3], shorts: [0.02, 0.05] },
  "Music & Dance": { long: [0.5, 2], shorts: [0.01, 0.04] },
  "News & Commentary": { long: [2, 6], shorts: [0.03, 0.08] },
  "Motivation & Self-Improvement": { long: [2, 6], shorts: [0.03, 0.08] },
  "Relationships & Social": { long: [2, 5], shorts: [0.03, 0.07] },
  "Art & Animation": { long: [1.5, 4], shorts: [0.02, 0.06] },
  "ASMR & Satisfying": { long: [1, 3], shorts: [0.02, 0.05] },
  "Kids & Family": { long: [0.5, 2], shorts: [0.01, 0.03] },
};

const DEFAULT_BAND: RpmBand = { long: [1.5, 4], shorts: [0.03, 0.07] };

/**
 * Words that give a category away when the dictionary doesn't know the topic.
 * First match wins, so the paying categories go first and ambiguous words are
 * spelled out in context ("python tutorial", not "python": that one's a snake).
 */
const CATEGORY_HINTS: [RegExp, NicheCategory][] = [
  [
    /\b(financ|invest|stock|crypto|money|budget|tax|real estate|business|side hustle|passive income|trading|credit|insurance|ira\b|401k|hsa\b|savings|loans?\b|debt|mortgage|refinanc|heloc|rental|landlord|property|airbnb|reits?\b|treasur|bonds\b|options trading|covered calls?|dividend|fire movement|frugal|llc\b|bookkeep|accounting|estate planning|wills and trusts|social security|medicare|annuit|identity theft|points and miles|airline miles|marketing|seo\b|google ads|facebook ads|affiliate|print on demand|etsy|shopify|kdp\b|dropship|ecommerce|digital products|cold email|lead gen|copywrit|branding|linkedin|resume|job interview|job search|remote jobs?|salary|career|freelanc|entrepreneur|startup|saas|sales\b|econom|housing market|legal|lawyer|attorney|tenant|small claims|immigration law|home ?buy|first time buyer|retire|house flip|balance transfer|amazon fba|fba\b)/,
    "Finance & Business",
  ],
  [
    /\b(tech|ai\b|phone|iphone|android|laptop|pc build|coding|programming|software|gadget|science|space|physics|excel|spreadsheet|google sheets|power bi|sql\b|python (?:tutorial|automation|script|code|coding|programming|for)|no code|zapier|notion\b|obsidian (?:notes|vault|app|plugins?)|canva|photoshop|davinci|premiere pro|wordpress|web hosting|website|vpn\b|password manager|home network|router|wifi|windows (?:1[01]|tips|pc|laptop)|macbook|macos|mac (?:tips|apps)|chrome extensions?|chatgpt|gpt\b|claude ai|llm|prompt engineering|aws\b|azure|cloud computing|comptia|it career|cyber|linux|automation|productivity apps?)/,
    "Science & Tech",
  ],
  [/\b(history|explain|learn|study|language|math|psycholog|philosoph|educat|facts?\b|geopolitic|supply chain|military|ancient|architect|engineer|how it'?s made|aviation|trucking|logistics|documentar|true crime|cold cases?|unsolved|serial killers?|missing persons?|myster)/, "Education & Explainers"],
  [/\b(fitness|gym|workout|diet|health|nutrition|yoga|running|weight loss|bodybuild|calisthenic|supplement|blood sugar|diabet|longevity|sleep (?:science|tips|hygiene|apnea)|dermatolog|physical therap|back pain|posture|stretch|nurs(?:e|ing)|doctor|medical|pharmac|dental|teeth)/, "Fitness & Health"],
  [/\b(car|cars|truck|motorcycle|detailing|mechanic|ev|tesla)\b/, "Cars & Vehicles"],
  [/\b(makeup|beauty|skincare|fashion|outfit|hair|nails|luxury|watches\b|wristwatch)/, "Beauty & Fashion"],
  [/\b(travel|camping|hiking|fishing|hunting|outdoor|cruise|digital nomad|moving abroad|expat|airport|flights?\b)/, "Travel & Outdoors"],
  [/\b(cook|recipe|food|baking|bbq|meal)/, "Food & Cooking"],
  [/\b(diy|craft|woodwork|home|garden|renovat|cleaning|plumb|hvac|roof|solar|heat pump|lawn|pest control|electrical|wiring|drywall|insulation)/, "DIY, Crafts & Home"],
  [/\b(game|gaming|minecraft|roblox|fortnite|gta|pokemon|monsters|speedrun|esports|nba ?2k|2k2\d)/, "Gaming"],
  [/\b(football|soccer|nba|basketball|nfl|sports?|boxing|ufc|golf|tennis|surf)/, "Sports"],
  [/\b(dog|cat|pet|animal|puppy|kitten)/, "Animals & Pets"],
  [/\b(music|song|dance|guitar|piano|singing|rap)/, "Music & Dance"],
  [/\b(comedy|skit|prank|funny|meme)/, "Comedy & Skits"],
  [/\b(movie|film|celebrity|anime|tv show|reaction|drama)/, "Entertainment & Pop Culture"],
  [/\b(vlog|lifestyle|routine|day in the life)/, "Lifestyle & Vlogs"],
];

/** The niche's category: the dictionary when it knows the name, otherwise telltale words. */
export function categoryFor(...names: string[]): NicheCategory | null {
  for (const name of names) {
    const key = normalizeName(name);
    if (!key) continue;
    const entry = NICHE_DICTIONARY.find((e) => normalizeName(e.name) === key || e.aliases.some((a) => normalizeName(a) === key));
    if (entry) return entry.category;
  }
  for (const name of names) {
    const text = name.toLowerCase();
    const hit = CATEGORY_HINTS.find(([pattern]) => pattern.test(text));
    if (hit) return hit[1];
  }
  return null;
}

/** Every category whose telltale words appear in the text, in hint order. */
export function categoriesIn(text: string): NicheCategory[] {
  const lower = text.toLowerCase();
  return CATEGORY_HINTS.filter(([pattern]) => pattern.test(lower)).map(([, category]) => category);
}

/** A category's RPM range for one format. */
export function rpmFor(category: NicheCategory | null, format: "shorts" | "long_form", term?: string): Range {
  const band = category === "Gaming" && term ? gamingBand(term) : category ? (RPM_BY_CATEGORY[category] ?? DEFAULT_BAND) : DEFAULT_BAND;
  return format === "shorts" ? band.shorts : band.long;
}

/**
 * Inside gaming, RPM follows the audience. Games played mostly by kids pay the
 * least (much of it is made-for-kids, with no personalised ads); strategy,
 * simulators, chess and PC hardware have older viewers advertisers pay more for.
 */
const OLDER_AUDIENCE =
  /\b(chess|poker|flight sim|microsoft flight|msfs|cities[: ]+skylines|factorio|satisfactory|civilization|civ (?:v|vi|vii|[5-7])\b|total war|hearts of iron|crusader kings|stellaris|europa universalis|eve online|star citizen|sim ?racing|iracing|assetto corsa|euro truck|american truck|farming simulator|tarkov|arma\b|dcs world|war thunder|world of tanks|anno \d|rimworld|kerbal|planet coaster|football manager|f1 2\d|gran turismo|pc build|gaming pc|graphics cards?|gpu\b|steam deck|magnus carlsen|hikaru|gotham ?chess|levy rozman)/i;
const YOUNG_AUDIENCE =
  /\b(roblox|minecraft|fortnite|among us|toca|gacha|brawl stars|subway surfers|geometry dash|five nights|fnaf|poppy playtime|skibidi|piggy|adopt me|blox fruits|bedwars|pet simulator|garten of banban|rainbow friends|stumble guys|murder mystery|brookhaven|bloxburg|dress to impress|grow a garden|steal a brainrot|99 nights)/i;

export type GameAudience = "older" | "typical" | "young";

export function gameAudience(term: string): GameAudience {
  return OLDER_AUDIENCE.test(term) ? "older" : YOUNG_AUDIENCE.test(term) ? "young" : "typical";
}

function gamingBand(term: string): RpmBand {
  const base = RPM_BY_CATEGORY.Gaming!;
  const factor = { older: 2, typical: 1, young: 0.6 }[gameAudience(term)];
  const scale = ([low, high]: Range, places: number): Range => [Number((low * factor).toFixed(places)), Number((high * factor).toFixed(places))];
  return { long: scale(base.long, 2), shorts: scale(base.shorts, 3) };
}

/**
 * Ad rates by where viewers are, against the mixed audience the category bands
 * assume. A channel's country stands in for its viewers': an American gaming
 * channel is watched mostly in rich ad markets, a Filipino one mostly at home.
 */
const HIGH_PAYING = new Set(["US", "CA", "GB", "AU", "NZ", "IE", "CH", "NO", "DK", "SE", "NL", "DE", "AT", "BE", "FI", "LU", "IS", "SG"]);
const MID_PAYING = new Set(["FR", "ES", "IT", "PT", "JP", "KR", "IL", "HK", "TW", "AE", "SA", "QA", "KW", "CZ", "PL"]);
const COUNTRY_RATE = { high: 1.4, mid: 0.8, low: 0.3 } as const;
const COUNTRY_NAME: Record<string, string> = {
  US: "the US", GB: "the UK", CA: "Canada", AU: "Australia", DE: "Germany", BR: "Brazil", ID: "Indonesia", IN: "India", PH: "the Philippines",
  MX: "Mexico", VN: "Vietnam", FR: "France", ES: "Spain", IT: "Italy", JP: "Japan", PL: "Poland", RU: "Russia", AR: "Argentina", MY: "Malaysia",
  TH: "Thailand", TR: "Turkey", PK: "Pakistan", BD: "Bangladesh", EG: "Egypt", NG: "Nigeria", CO: "Colombia", PE: "Peru", CL: "Chile", ZA: "South Africa", KR: "Korea", RO: "Romania", UA: "Ukraine", SA: "Saudi Arabia",
};

function countryTier(country: string): keyof typeof COUNTRY_RATE {
  return HIGH_PAYING.has(country) ? "high" : MID_PAYING.has(country) ? "mid" : "low";
}

/** One upload's say in who a niche's audience is. */
export interface AudienceSignal {
  channelId: string;
  /** The channel's country, when it lists one. */
  country: string | null;
  madeForKids: boolean;
  /** Length in minutes, when known. */
  minutes: number | null;
  views: number;
}

export interface RpmAdjustment {
  /** Multiply the category's RPM band by this. */
  factor: number;
  /** Why, in a few words, when the audience moves it. */
  note: string | null;
}

/** Uploads with a known country, from this many channels, before geography counts. */
const MIN_COUNTRY_CHANNELS = 3;

/**
 * How a niche's own audience moves its RPM off the category's typical band:
 * where its channels are, how much of it is made for kids (no personalised
 * ads), and for long-form, whether videos run 8+ minutes (mid-roll ads).
 * Bigger uploads count more, but by the square root so one hit can't decide it.
 */
export function audienceAdjustment(signals: readonly AudienceSignal[], format: "shorts" | "long_form"): RpmAdjustment {
  if (signals.length === 0) return { factor: 1, note: null };
  const weight = (s: AudienceSignal) => Math.sqrt(Math.max(s.views, 0) + 1);
  const total = signals.reduce((sum, s) => sum + weight(s), 0);

  const located = signals.filter((s) => s.country);
  const byTier = { high: 0, mid: 0, low: 0 };
  const lowCountries = new Map<string, number>();
  let locatedWeight = 0;
  for (const s of located) {
    const tier = countryTier(s.country!);
    byTier[tier] += weight(s);
    locatedWeight += weight(s);
    if (tier === "low") lowCountries.set(s.country!, (lowCountries.get(s.country!) ?? 0) + weight(s));
  }
  const geoKnown = new Set(located.map((s) => s.channelId)).size >= MIN_COUNTRY_CHANNELS;
  const share = (tier: keyof typeof byTier) => (locatedWeight > 0 ? byTier[tier] / locatedWeight : 0);
  const geo = geoKnown ? share("high") * COUNTRY_RATE.high + share("mid") * COUNTRY_RATE.mid + share("low") * COUNTRY_RATE.low : 1;

  const kidsShare = signals.reduce((sum, s) => sum + (s.madeForKids ? weight(s) : 0), 0) / total;
  const kids = 1 - 0.7 * kidsShare;

  const timed = signals.filter((s) => s.minutes !== null);
  const longShare = timed.length > 0 ? timed.reduce((sum, s) => sum + (s.minutes! >= 8 ? weight(s) : 0), 0) / timed.reduce((sum, s) => sum + weight(s), 0) : null;
  const length = format === "long_form" && longShare !== null ? 0.85 + 0.3 * longShare : 1;

  const factor = Math.min(Math.max(geo * kids * length, 0.2), 1.8);
  const notes: string[] = [];
  if (kidsShare >= 0.3) notes.push("lots of made-for-kids uploads, which get no personalised ads");
  if (geoKnown && share("high") >= 0.7) notes.push("viewers mostly in high-paying countries like the US and UK");
  else if (geoKnown && share("low") >= 0.5) {
    const top = [...lowCountries].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => COUNTRY_NAME[c] ?? c);
    notes.push(`many viewers in lower-paying ad markets like ${top.join(" and ")}`);
  }
  if (format === "long_form" && longShare !== null && longShare < 0.3) notes.push("most videos under 8 minutes, so few mid-roll ads");
  else if (format === "long_form" && longShare !== null && longShare >= 0.7) notes.push("8+ minute videos with room for mid-roll ads");
  const note = notes.length > 0 ? notes[0]!.charAt(0).toUpperCase() + notes[0]!.slice(1) : null;
  return { factor: Number(factor.toFixed(3)), note };
}

/** A band scaled for its audience, rounded to what's worth showing. */
export function adjustRpm([low, high]: Range, factor: number, format: "shorts" | "long_form"): Range {
  const places = format === "shorts" ? 3 : 2;
  return [Number((low * factor).toFixed(places)), Number((high * factor).toFixed(places))];
}

export interface NicheEarnings {
  category: NicheCategory | null;
  rpm: RpmBand;
  /** RPM for this niche's mix of Shorts and long-form views. */
  blendedRpm: Range;
  /** Estimated monthly earnings for a typical active channel, and for the biggest one in the sample. */
  typicalMonthly: Range;
  topMonthly: Range;
  monthlyViews: { typical: number; top: number };
}

const mix = (band: RpmBand, shortsShare: number): Range => [
  band.shorts[0] * shortsShare + band.long[0] * (1 - shortsShare),
  band.shorts[1] * shortsShare + band.long[1] * (1 - shortsShare),
];
const earn = (views: number, rpm: Range): Range => [(views / 1000) * rpm[0], (views / 1000) * rpm[1]];

/** Earnings for a niche, or null when the report predates monthly views. */
export function estimateEarnings(
  monthlyViews: { typical: number; top: number; shortsShare: number } | undefined,
  ...names: string[]
): NicheEarnings | null {
  if (!monthlyViews) return null;
  const category = categoryFor(...names);
  const rpm = category === "Gaming" ? gamingBand(names.join(" ")) : category ? (RPM_BY_CATEGORY[category] ?? DEFAULT_BAND) : DEFAULT_BAND;
  const blendedRpm = mix(rpm, monthlyViews.shortsShare);
  return {
    category,
    rpm,
    blendedRpm,
    typicalMonthly: earn(monthlyViews.typical, blendedRpm),
    topMonthly: earn(monthlyViews.top, blendedRpm),
    monthlyViews: { typical: monthlyViews.typical, top: monthlyViews.top },
  };
}

/** "$1.20", "$850", "$12K": precise at small amounts, compact at large ones. */
export function formatMoney(value: number): string {
  if (value < 10) return `$${value.toFixed(2)}`;
  if (value < 1000) return `$${Math.round(value)}`;
  if (value < 1_000_000) return `$${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}K`;
  return `$${(value / 1_000_000).toFixed(1)}M`;
}

export function formatMoneyRange([low, high]: Range): string {
  const a = formatMoney(low);
  const b = formatMoney(high);
  return a === b ? a : `${a}–${b}`;
}
