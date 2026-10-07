/**
 * New tools nobody has made tutorials for yet. Apps, AI models and open-source
 * tools that just took off on Hacker News (Show HN) and GitHub get searched on
 * YouTube within weeks ("how to use X", "X tutorial"), and the first decent
 * videos own those searches for years. Tech pays well, too.
 *
 * Both APIs are public and keyless: HN through Algolia (about 10,000 requests an
 * hour), GitHub search at 10 a minute unauthenticated. A sweep is two requests.
 */

import { z } from "zod";
import type { TextProvider } from "@/lib/ai/types";
import { normalizeKeyword } from "./suggest";

export interface Launch {
  source: "hn" | "github";
  title: string;
  description: string;
  url: string;
  /** HN points or GitHub stars. */
  score: number;
}

const DAY = 86_400_000;

export async function fetchLaunches(options: { days?: number; now?: Date; fetch?: typeof fetch; signal?: AbortSignal } = {}): Promise<Launch[]> {
  const now = options.now ?? new Date();
  const days = options.days ?? 7;
  const get = options.fetch ?? fetch;
  const signal = options.signal ?? AbortSignal.timeout(15_000);
  const since = Math.floor((now.getTime() - days * DAY) / 1000);
  const created = new Date(now.getTime() - days * 3 * DAY).toISOString().slice(0, 10);

  const [hn, gh] = await Promise.allSettled([
    get(`https://hn.algolia.com/api/v1/search?tags=show_hn&numericFilters=created_at_i>${since},points>25&hitsPerPage=100`, { signal }).then((r) => r.json()),
    // GitHub's window is wider: a repo takes a few weeks to collect its stars.
    get(`https://api.github.com/search/repositories?q=created:>${created}+stars:>300&sort=stars&order=desc&per_page=60`, {
      signal,
      headers: { accept: "application/vnd.github+json", "user-agent": "outlier-niche-radar" },
    }).then((r) => r.json()),
  ]);

  const out: Launch[] = [];
  if (hn.status === "fulfilled") {
    for (const h of (hn.value as { hits?: { title?: string; url?: string | null; objectID?: string; points?: number }[] }).hits ?? []) {
      if (!h.title || !h.objectID) continue;
      out.push({ source: "hn", title: h.title.replace(/^Show HN:\s*/i, ""), description: "", url: `https://news.ycombinator.com/item?id=${h.objectID}`, score: h.points ?? 0 });
    }
  }
  if (gh.status === "fulfilled") {
    for (const r of (gh.value as { items?: { full_name?: string; name?: string; description?: string | null; html_url?: string; stargazers_count?: number }[] }).items ?? []) {
      if (!r.name || !r.html_url) continue;
      out.push({ source: "github", title: r.name, description: (r.description ?? "").slice(0, 200), url: r.html_url, score: r.stargazers_count ?? 0 });
    }
  }
  return out;
}

const schema = z.object({
  tools: z.array(z.object({ name: z.string(), phrase: z.string(), from: z.number().int() })),
});

const PROMPT = `You spot YouTube tutorial niches in new tech launches for Outlier, a research tool for creators.

You get this week's top Show HN posts and fastest-rising new GitHub repos, numbered. Pick the ones ordinary people (not only programmers) will search YouTube for help with in the coming months: apps, AI tools and models people run themselves, creative and productivity software, self-hosted alternatives to paid products. Skip libraries, frameworks, research code, toy demos, lists, books and anything without a clear name. For each, give its name and the search phrase someone would type (e.g. "comfyui tutorial", "how to use open webui", "photocraft vs photoshop"), lowercase, and the number it came from. At most 20.`;

export interface LaunchPhrase {
  name: string;
  phrase: string;
  url: string;
  /** HN points or GitHub stars. */
  score: number;
}

export async function launchPhrases(ai: Pick<TextProvider, "generateObject">, launches: readonly Launch[]): Promise<LaunchPhrase[]> {
  if (launches.length === 0) return [];
  const list = launches.map((l, i) => `[${i}] ${l.source === "hn" ? "Show HN" : "GitHub"} (${l.score}): ${l.title}${l.description ? ` - ${l.description}` : ""}`);
  const { object } = await ai.generateObject({
    system: PROMPT,
    messages: [{ role: "user", content: list.join("\n") }],
    schema,
    schemaName: "launch_phrases",
    maxOutputTokens: 2_000,
    effort: "low",
  });
  const seen = new Set<string>();
  return object.tools.flatMap((t) => {
    const launch = launches[t.from];
    const phrase = normalizeKeyword(t.phrase);
    if (!launch || phrase.split(" ").length < 2 || phrase.length > 80 || seen.has(phrase)) return [];
    seen.add(phrase);
    return [{ name: t.name.trim(), phrase, url: launch.url, score: launch.score }];
  });
}
