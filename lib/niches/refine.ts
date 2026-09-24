import { z } from "zod";
import type { TextProvider } from "@/lib/ai/types";
import type { SubNiche } from "./analysis";

/**
 * A last pass over a report's sub-niche names by a small model.
 *
 * Mining titles gets the groups right but not always the names: game titles
 * capitalize every word, so "Lobby", "Unit" and "Choose" look like names to any
 * rule, and hashtags leave "Sypherpk Gets" behind. A model that sees the topic
 * and a few titles per group can tell a real niche from a word, and name it the
 * way the community does. It only keeps, drops and renames — it never adds.
 */

const REFINED = z.object({
  niches: z.array(
    z.object({
      index: z.number().int(),
      keep: z.boolean(),
      name: z.string(),
    }),
  ),
});

const SYSTEM = [
  "You clean up sub-niche names for a YouTube research tool.",
  "You get a topic and candidate sub-niches that were mined from video titles, each with a few of its titles.",
  "Keep a candidate only if it is a real, recurring thing creators make videos about inside the topic: a character, mode, map, event, series, mechanic, item family, format, or community trend.",
  "Drop: ordinary words that are not a theme on their own (Choose, Lobby, Wave, Unit, Form, Admin, Codes), other games or unrelated topics, creator or channel names, hashtag mashes, and fragments.",
  "For each kept one, give the name people in that community would use: 1 to 4 words, Title Case, official spellings (\"Tears of the Kingdom\", not \"Totk Zelda\"). Lead with the game or character when the group is about one.",
  "Never invent a niche that the titles don't show. When unsure, drop it.",
].join("\n");

/** How long a report build waits for the names before keeping the mined ones. */
const REFINE_TIMEOUT_MS = 8_000;

export async function refineSubNiches(
  ai: Pick<TextProvider, "generateObject">,
  topic: string,
  subNiches: readonly SubNiche[],
): Promise<SubNiche[]> {
  if (subNiches.length === 0) return [];
  const listing = subNiches
    .map((sub, index) => {
      const titles = [...new Set([...(sub.examples ?? []).map((e) => e.title), ...sub.metrics.breakouts.map((b) => b.title)])].slice(0, 5);
      return `${index}. ${sub.term}\n${titles.map((t) => `   - ${t.slice(0, 120)}`).join("\n")}`;
    })
    .join("\n");

  const { object } = await ai.generateObject({
    system: SYSTEM,
    messages: [{ role: "user", content: `Topic: ${topic}\n\nCandidates:\n${listing}\n\nReturn one entry per candidate, by index.` }],
    schema: REFINED,
    schemaName: "niche_names",
    maxOutputTokens: 1_500,
    signal: AbortSignal.timeout(REFINE_TIMEOUT_MS),
  });

  const byIndex = new Map(object.niches.map((n) => [n.index, n]));
  const seen = new Set<string>();
  const kept: SubNiche[] = [];
  for (const [index, sub] of subNiches.entries()) {
    const verdict = byIndex.get(index);
    // A candidate the model skipped keeps its mined name rather than vanishing.
    if (verdict && !verdict.keep) continue;
    const name = verdict?.name.trim().slice(0, 60) || sub.term;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ ...sub, term: name });
  }
  return kept;
}
