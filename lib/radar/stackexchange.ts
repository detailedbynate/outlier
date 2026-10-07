/**
 * Stack Exchange: questions people search for, with how often they're read. A
 * money.stackexchange question viewed 300K times is years of steady search
 * demand, and most have no good video answer. Each site's popular tags are
 * curated topic names ("roth-ira", "credit-score"), which make clean radar seeds.
 *
 * The API needs no sign-in: 300 requests a day per IP without a key, 10,000
 * with a free one (STACKEXCHANGE_KEY). A full sweep is about 2 requests a site.
 * Content is CC BY-SA, so ideas always keep their link back to the question.
 */

import type { NicheCategory } from "@/lib/niches/labeling";

/** Sites whose questions make videos, by category. */
export const STACK_SITES: Record<string, NicheCategory> = {
  money: "Finance & Business",
  law: "Finance & Business",
  workplace: "Finance & Business",
  freelancing: "Finance & Business",
  superuser: "Science & Tech",
  webapps: "Science & Tech",
  apple: "Science & Tech",
  android: "Science & Tech",
  ai: "Science & Tech",
  security: "Science & Tech",
  video: "Science & Tech",
  gaming: "Gaming",
  diy: "DIY, Crafts & Home",
  woodworking: "DIY, Crafts & Home",
  "3dprinting": "DIY, Crafts & Home",
  gardening: "DIY, Crafts & Home",
  cooking: "Food & Cooking",
  fitness: "Fitness & Health",
  travel: "Travel & Outdoors",
  outdoors: "Travel & Outdoors",
  expatriates: "Travel & Outdoors",
  bicycles: "Sports",
  mechanics: "Cars & Vehicles",
  photo: "Art & Animation",
  pets: "Animals & Pets",
  parenting: "Kids & Family",
  interpersonal: "Relationships & Social",
  academia: "Education & Explainers",
  history: "Education & Explainers",
  astronomy: "Education & Explainers",
  space: "Education & Explainers",
  languagelearning: "Education & Explainers",
  lifehacks: "Motivation & Self-Improvement",
};

export interface StackQuestion {
  /** e.g. "money.stackexchange.com" */
  community: string;
  title: string;
  url: string;
  score: number;
  views: number;
  answers: number;
  postedAt: string;
  category: NicheCategory | null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };

/** Titles come HTML-encoded ("Can&#39;t", "&amp;"). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    const lower = code.toLowerCase();
    if (ENTITIES[lower]) return ENTITIES[lower]!;
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return match;
  });
}

interface QuestionsBody {
  items?: { title?: string; link?: string; score?: number; view_count?: number; answer_count?: number; creation_date?: number; closed_date?: number }[];
  backoff?: number;
  quota_remaining?: number;
  error_message?: string;
}

export function parseQuestions(body: unknown, site: string): StackQuestion[] {
  const items = (body as QuestionsBody)?.items ?? [];
  return items.flatMap((q) => {
    // Closed questions are off-topic or duplicates: not a demand signal worth a video.
    if (!q.title || !q.link || q.closed_date) return [];
    return [
      {
        community: `${site}.stackexchange.com`,
        title: decodeEntities(q.title).slice(0, 300),
        url: q.link,
        score: q.score ?? 0,
        views: q.view_count ?? 0,
        answers: q.answer_count ?? 0,
        postedAt: new Date((q.creation_date ?? 0) * 1000).toISOString(),
        category: STACK_SITES[site] ?? null,
      },
    ];
  });
}

/** Where a question is from, not what it's about: not a niche. */
const PLACE_TAG =
  /^(united-states|united-kingdom|usa|uk|us|canada|india|australia|germany|france|netherlands|ireland|spain|italy|japan|china|europe|european-union|new-zealand|switzerland|sweden|poland|brazil|mexico|singapore|israel|california|new-york|texas|florida)$/;
/** Site housekeeping and too-generic labels. */
const META_TAG = /^(untagged|discussion|support|feature-request|bug|identify-this-game|identification|terminology|definition|website|software|hardware|troubleshooting|error|best-practices)$/;

/** Sites whose tags are a list of products rather than topics (gaming's are old games). */
export const NO_TAG_SITES = new Set(["gaming"]);

/**
 * A site's popular tags as plain phrases ("roth-ira" → "roth ira"). Multi-word tags
 * are specific enough to seed on their own; one-word tags only when they're among
 * the site's biggest ("mortgage", "plumbing"), since the rest ("water", "doors")
 * grow into noise.
 */
export function parseTags(body: unknown, options: { minCount?: number; limit?: number; singleWords?: number } = {}): string[] {
  const items = (body as { items?: { name?: string; count?: number }[] })?.items ?? [];
  let singles = options.singleWords ?? 5;
  return items
    .filter((t) => t.name && (t.count ?? 0) >= (options.minCount ?? 100) && !PLACE_TAG.test(t.name) && !META_TAG.test(t.name))
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .map((t) => t.name!.replace(/-/g, " ").replace(/\s+/g, " ").trim())
    // Version tags ("windows 10", "ios 17") are a product's history, not a topic.
    .filter((name) => name.length >= 3 && !/\d/.test(name))
    .filter((name) => name.includes(" ") || singles-- > 0)
    .slice(0, options.limit ?? 15);
}

export class StackExchangeClient {
  private pauseUntil = 0;

  constructor(private readonly options: { key?: string | null; fetch?: typeof fetch; spacingMs?: number; sleep?: (ms: number) => Promise<void> } = {}) {}

  private async get(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    const wait = this.pauseUntil - Date.now();
    if (wait > 0) await (this.options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(wait);
    const url = new URL(`https://api.stackexchange.com/2.3/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (this.options.key) url.searchParams.set("key", this.options.key);
    const response = await (this.options.fetch ?? fetch)(url, { headers: { accept: "application/json" }, signal: signal ?? AbortSignal.timeout(15_000) });
    const body = (await response.json().catch(() => null)) as QuestionsBody | null;
    // The API asks clients to hold off with `backoff` (seconds); ignoring it gets the IP banned.
    if (body?.backoff) this.pauseUntil = Date.now() + body.backoff * 1000;
    if (!response.ok) throw new Error(`Stack Exchange ${path} failed (${response.status}): ${body?.error_message ?? ""}`.trim());
    if (body?.quota_remaining !== undefined && body.quota_remaining < 5) throw new Error("Stack Exchange daily quota nearly used up");
    return body;
  }

  /** The month's most-voted questions and the all-time most-voted (evergreen) ones. */
  async questions(site: string, signal?: AbortSignal): Promise<StackQuestion[]> {
    const month = await this.get("questions", { site, order: "desc", sort: "month", pagesize: "30" }, signal);
    await this.pause();
    const top = await this.get("questions", { site, order: "desc", sort: "votes", pagesize: "30" }, signal);
    const seen = new Set<string>();
    return [...parseQuestions(month, site), ...parseQuestions(top, site)].filter((q) => !seen.has(q.url) && seen.add(q.url));
  }

  async tags(site: string, signal?: AbortSignal): Promise<string[]> {
    return parseTags(await this.get("tags", { site, order: "desc", sort: "popular", pagesize: "60" }, signal));
  }

  private pause(): Promise<void> {
    const ms = this.options.spacingMs ?? 1_000;
    return ms > 0 ? (this.options.sleep ?? ((t) => new Promise((r) => setTimeout(r, t))))(ms) : Promise.resolve();
  }

  /** Every site, one after another. A site that fails is skipped; a quota or ban stops the sweep. */
  async sweep(sites: readonly string[], options: { signal?: AbortSignal; withTags?: boolean } = {}): Promise<{ questions: StackQuestion[]; tags: { site: string; tags: string[] }[] }> {
    const questions: StackQuestion[] = [];
    const tags: { site: string; tags: string[] }[] = [];
    for (const site of sites) {
      if (options.signal?.aborted) break;
      try {
        questions.push(...(await this.questions(site, options.signal)));
        if (options.withTags && !NO_TAG_SITES.has(site)) {
          await this.pause();
          tags.push({ site, tags: await this.tags(site, options.signal) });
        }
      } catch (error) {
        if (error instanceof Error && /quota|throttle|too many requests|\(4(29|03)\)/i.test(error.message)) break;
      }
      await this.pause();
    }
    return { questions, tags };
  }
}
