/**
 * Other-language markets. A phrase that's crowded in English is often wide open
 * in German or Japanese: the same viewers' questions, a fraction of the videos.
 * German and Japanese pay close to English; Spanish and Portuguese pay much less
 * per view but have huge, underserved audiences.
 *
 * The radar translates its best English phrases and reads what ranks for them
 * with YouTube set to that language and country.
 */

import { z } from "zod";
import type { TextProvider } from "@/lib/ai/types";
import { normalizeKeyword } from "./suggest";

export interface Market {
  /** YouTube's interface language for the search. */
  lang: string;
  /** Country the search runs from. */
  location: string;
  label: string;
  /**
   * Rough RPM next to English (US-heavy) audiences, from public creator
   * reports. It moves with the season and the audience's country.
   */
  rpmFactor: number;
}

export const MARKETS = {
  en: { lang: "en", location: "US", label: "English", rpmFactor: 1 },
  de: { lang: "de", location: "DE", label: "German", rpmFactor: 0.85 },
  ja: { lang: "ja", location: "JP", label: "Japanese", rpmFactor: 0.7 },
  fr: { lang: "fr", location: "FR", label: "French", rpmFactor: 0.6 },
  es: { lang: "es", location: "MX", label: "Spanish", rpmFactor: 0.35 },
  pt: { lang: "pt", location: "BR", label: "Portuguese", rpmFactor: 0.3 },
} as const satisfies Record<string, Market>;

export type MarketCode = keyof typeof MARKETS;

/** The markets phrases get translated into. */
export const FOREIGN_MARKETS = (Object.keys(MARKETS) as MarketCode[]).filter((m) => m !== "en");

export function marketOf(code: string | null | undefined): Market {
  return MARKETS[(code ?? "en") as MarketCode] ?? MARKETS.en;
}

const translationSchema = z.object({
  phrases: z.array(
    z.object({
      english: z.string(),
      de: z.string(),
      ja: z.string(),
      fr: z.string(),
      es: z.string(),
      pt: z.string(),
    }),
  ),
});

const PROMPT = `You translate YouTube search phrases for Outlier, a research tool for creators.

For each English phrase, write what a native speaker would actually type into YouTube to find the same videos, in German (de), Japanese (ja), French (fr), Spanish (es, Latin American) and Portuguese (pt, Brazilian). Search phrases, not sentences: short, lowercase, no punctuation. Use the local term for local things (a "roth ira" has no German equivalent, so use what Germans save for retirement with, e.g. "etf sparplan"); keep brand and product names as they are. Return "english" exactly as given.`;

export interface Translation {
  english: string;
  market: MarketCode;
  phrase: string;
}

/** One model call for a batch of phrases. Translations that come back equal to the English are dropped: they'd be the same search. */
export async function translatePhrases(ai: Pick<TextProvider, "generateObject">, phrases: readonly string[]): Promise<Translation[]> {
  if (phrases.length === 0) return [];
  const { object } = await ai.generateObject({
    system: PROMPT,
    messages: [{ role: "user", content: phrases.join("\n") }],
    schema: translationSchema,
    schemaName: "radar_translations",
    maxOutputTokens: 4_000,
    effort: "low",
  });
  const asked = new Set(phrases.map(normalizeKeyword));
  return object.phrases.flatMap((row) => {
    const english = normalizeKeyword(row.english);
    if (!asked.has(english)) return [];
    return FOREIGN_MARKETS.flatMap((market) => {
      const phrase = normalizeKeyword(row[market]);
      return phrase.length >= 2 && phrase.length <= 80 && phrase !== english ? [{ english, market, phrase }] : [];
    });
  });
}
