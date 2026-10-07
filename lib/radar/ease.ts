/**
 * How easy a niche is to make, judged by a cheap model from what actually ranks
 * for it: the top titles, how long they run, and how many are Shorts. Comes back
 * with what a newcomer needs to produce it and three video ideas, so a niche
 * card answers "could I make this tomorrow?" and "what would I post first?".
 */

import { z } from "zod";
import type { TextProvider } from "@/lib/ai/types";

export const easeSchema = z.object({
  niches: z.array(
    z.object({
      keyword: z.string(),
      /** 0-100: 100 = one person with a laptop can make it today. */
      ease: z.number(),
      faceless: z.boolean(),
      /** What it takes: voiceover, screen recording, stock footage, AI visuals, gameplay capture, filming, on-camera, editing-heavy... */
      production: z.array(z.string()),
      /** One sentence: how a newcomer would make these videos. */
      how: z.string(),
      /** Three specific video ideas a newcomer could post first. */
      ideas: z.array(z.string()),
    }),
  ),
});

export type EaseRating = z.infer<typeof easeSchema>["niches"][number];

export interface EaseInput {
  keyword: string;
  titles: string[];
  shortsShare: number | null;
  medianMinutes: number | null;
}

const SYSTEM = `You rate YouTube niches for Outlier, a research tool for new creators.

For each niche you get the search phrase and the titles of videos that rank for it. Judge what it takes to make videos like these:
- ease: 0-100. 90+ = faceless, scriptable, one person with a laptop (voiceover over stock or screen footage, AI visuals, text stories, explainers). 50-70 = needs some skill or gear (gameplay capture, simple filming at home, light animation). Under 40 = needs travel, hands-on builds, expensive gear, a crew, credentials or real-world access.
- faceless: can it be done well without showing a face?
- production: 2-4 short tags for what it needs.
- how: one plain sentence on how a newcomer would make these.
- ideas: three specific first videos, written as titles, built on what's working in the titles you were given but not copying them.

Be honest about effort. Don't call something easy because the topic is simple if the videos need filming.`;

export async function rateEase(ai: Pick<TextProvider, "generateObject">, inputs: readonly EaseInput[]): Promise<EaseRating[]> {
  if (inputs.length === 0) return [];
  const content = inputs
    .map((i) => {
      const format = [
        i.shortsShare !== null ? `${Math.round(i.shortsShare * 100)}% Shorts` : null,
        i.medianMinutes !== null ? `long videos ~${i.medianMinutes} min` : null,
      ]
        .filter(Boolean)
        .join(", ");
      return `Niche: ${i.keyword}${format ? ` (${format})` : ""}\n${i.titles.slice(0, 6).map((t) => `- ${t}`).join("\n")}`;
    })
    .join("\n\n");
  const { object } = await ai.generateObject({
    system: SYSTEM,
    messages: [{ role: "user", content }],
    schema: easeSchema,
    schemaName: "niche_ease",
    maxOutputTokens: 400 * inputs.length + 200,
    effort: "low",
  });
  const wanted = new Set(inputs.map((i) => i.keyword));
  return object.niches
    .filter((n) => wanted.has(n.keyword))
    .map((n) => ({
      ...n,
      ease: Math.max(0, Math.min(100, Math.round(n.ease))),
      production: n.production.slice(0, 4),
      ideas: n.ideas.slice(0, 3),
    }));
}
