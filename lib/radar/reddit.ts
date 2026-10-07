/**
 * Reddit: what people in high-paying communities ask and argue about this week.
 * Questions are video ideas almost word for word ("Is it worth paying off a 3%
 * mortgage early?"), and topics that keep coming up become radar phrases.
 *
 * Reddit walls off anonymous requests from servers, so this uses an app-only
 * OAuth token (REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET, a free "script" app at
 * reddit.com/prefs/apps). Without them it stays off. Requests are spaced out
 * well under Reddit's 100-per-minute limit for OAuth clients.
 */

import type { NicheCategory } from "@/lib/niches/labeling";

/** Communities by category: big enough to be a real audience, specific enough to be a niche. */
export const SUBREDDITS: Record<string, NicheCategory> = {
  personalfinance: "Finance & Business",
  financialindependence: "Finance & Business",
  investing: "Finance & Business",
  stocks: "Finance & Business",
  dividends: "Finance & Business",
  realestateinvesting: "Finance & Business",
  creditcards: "Finance & Business",
  churning: "Finance & Business",
  tax: "Finance & Business",
  insurance: "Finance & Business",
  povertyfinance: "Finance & Business",
  sidehustle: "Finance & Business",
  entrepreneur: "Finance & Business",
  smallbusiness: "Finance & Business",
  ecommerce: "Finance & Business",
  marketing: "Finance & Business",
  sales: "Finance & Business",
  saas: "Finance & Business",
  legaladvice: "Finance & Business",
  careerguidance: "Finance & Business",
  artificial: "Science & Tech",
  chatgpt: "Science & Tech",
  localllama: "Science & Tech",
  sysadmin: "Science & Tech",
  cybersecurity: "Science & Tech",
  homeautomation: "Science & Tech",
  buildapc: "Science & Tech",
  excel: "Science & Tech",
  productivity: "Science & Tech",
  space: "Science & Tech",
  askhistorians: "Education & Explainers",
  explainlikeimfive: "Education & Explainers",
  todayilearned: "Education & Explainers",
  psychology: "Education & Explainers",
  unresolvedmysteries: "Education & Explainers",
  truecrime: "Education & Explainers",
  languagelearning: "Education & Explainers",
  stoicism: "Motivation & Self-Improvement",
  getdisciplined: "Motivation & Self-Improvement",
  decidingtobebetter: "Motivation & Self-Improvement",
  fitness: "Fitness & Health",
  nutrition: "Fitness & Health",
  skincareaddiction: "Beauty & Fashion",
  malefashionadvice: "Beauty & Fashion",
  mechanicadvice: "Cars & Vehicles",
  whatcarshouldibuy: "Cars & Vehicles",
  homeimprovement: "DIY, Crafts & Home",
  cooking: "Food & Cooking",
  travel: "Travel & Outdoors",
  relationship_advice: "Relationships & Social",
  parenting: "Relationships & Social",
};

export interface RedditPost {
  community: string;
  title: string;
  url: string;
  score: number;
  comments: number;
  postedAt: string;
  kind: "question" | "story" | "discussion";
  category: NicheCategory | null;
}

const QUESTION = /\?\s*$|^(how|what|why|which|when|where|who|is|are|does|do|did|can|could|should|would|will|has|have|any(one|body)?|eli5)\b/i;
const STORY = /^(i|my|we|our|just|finally|update|after)\b|\b(i (just|finally)|my (wife|husband|boss|dad|mom)|update:)\b/i;

export function classifyTitle(title: string): RedditPost["kind"] {
  if (QUESTION.test(title.trim())) return "question";
  if (STORY.test(title.trim())) return "story";
  return "discussion";
}

interface Listing {
  data?: { children?: { data?: { title?: string; permalink?: string; score?: number; num_comments?: number; created_utc?: number; stickied?: boolean; over_18?: boolean; subreddit?: string } }[] };
}

export function parseListing(body: unknown, community: string): RedditPost[] {
  const children = (body as Listing)?.data?.children ?? [];
  return children.flatMap(({ data }) => {
    if (!data?.title || !data.permalink || data.stickied || data.over_18) return [];
    const name = (data.subreddit ?? community).toLowerCase();
    return [
      {
        community: `r/${data.subreddit ?? community}`,
        title: data.title.slice(0, 300),
        url: `https://www.reddit.com${data.permalink}`,
        score: data.score ?? 0,
        comments: data.num_comments ?? 0,
        postedAt: new Date((data.created_utc ?? 0) * 1000).toISOString(),
        kind: classifyTitle(data.title),
        category: SUBREDDITS[name] ?? null,
      },
    ];
  });
}

const USER_AGENT = "server:online.useoutlier.radar:v1.0 (niche research)";

export class RedditClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly credentials: { clientId: string; clientSecret: string },
    private readonly options: { fetch?: typeof fetch; spacingMs?: number } = {},
  ) {}

  private get fetch(): typeof fetch {
    return this.options.fetch ?? fetch;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const auth = Buffer.from(`${this.credentials.clientId}:${this.credentials.clientSecret}`).toString("base64");
    const response = await this.fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Reddit token request failed (${response.status})`);
    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error("Reddit token response had no token");
    this.token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  /** This week's top posts in one community. */
  async top(community: string, options: { period?: "day" | "week" | "month"; limit?: number; signal?: AbortSignal } = {}): Promise<RedditPost[]> {
    const token = await this.accessToken();
    const url = `https://oauth.reddit.com/r/${encodeURIComponent(community)}/top?t=${options.period ?? "week"}&limit=${options.limit ?? 50}&raw_json=1`;
    const response = await this.fetch(url, {
      headers: { authorization: `Bearer ${token}`, "user-agent": USER_AGENT },
      signal: options.signal ?? AbortSignal.timeout(15_000),
    });
    if (response.status === 404 || response.status === 403) return [];
    if (!response.ok) throw new Error(`Reddit listing failed for r/${community} (${response.status})`);
    return parseListing(await response.json(), community);
  }

  /** Top posts across many communities, one request at a time. */
  async sweep(communities: readonly string[], options: { signal?: AbortSignal; period?: "day" | "week" | "month" } = {}): Promise<RedditPost[]> {
    const posts: RedditPost[] = [];
    for (const community of communities) {
      if (options.signal?.aborted) break;
      try {
        posts.push(...(await this.top(community, { period: options.period, signal: options.signal })));
      } catch {
        // One community failing shouldn't cost the rest.
      }
      await new Promise((r) => setTimeout(r, this.options.spacingMs ?? 1_500));
    }
    return posts;
  }
}
