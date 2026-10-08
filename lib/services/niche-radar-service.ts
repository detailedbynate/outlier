import { z } from "zod";
import type { TextProvider } from "@/lib/ai/types";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { RadarRepository } from "@/lib/database/repositories/radar";
import type { NicheCategory } from "@/lib/niches/labeling";
import { categoryFor } from "@/lib/niches/revenue";
import type { DataForSeoClient, Demand } from "@/lib/radar/demand";
import { rateEase, type EaseRating } from "@/lib/radar/ease";
import { marketOf, translatePhrases, type MarketCode } from "@/lib/radar/markets";
import { extractRequests } from "@/lib/radar/requests";
import { gameSearchPhrase, type RisingGame } from "@/lib/radar/games";
import { launchPhrases, type Launch } from "@/lib/radar/launches";
import type { VideoComment } from "@/lib/innertube/comments";
import { SUBREDDITS, type RedditClient, type RedditPost } from "@/lib/radar/reddit";
import { STACK_SITES, type StackExchangeClient } from "@/lib/radar/stackexchange";
import { priorityOf } from "@/lib/radar/priority";
import { scoreRadar, type RadarScore } from "@/lib/radar/score";
import { expansionQueries, isUsefulPhrase, normalizeKeyword, type Suggestion } from "@/lib/radar/suggest";
import { measureSupply, type Supply } from "@/lib/radar/supply";
import type { Json, NicheIdeaRow, NicheKeywordRow, TablesInsert } from "@/types/database";
import type { YouTubeChannel, YouTubeSearchResult, YouTubeVideo } from "@/types/youtube";

/**
 * The Niche Radar: finds niches the channel library doesn't know about yet.
 *
 *   seeds → YouTube autocomplete (thousands of real search phrases)
 *         → supply: what ranks for each phrase (old results? small channels winning?)
 *         → demand + pay: Google search volume and CPC (DataForSEO, when set up)
 *         → ease: can one person make it, and three first videos (AI)
 *         → score, and the best phrases go back to library growth as seeds.
 *
 * Reddit adds phrases and video ideas from high-paying communities; Stack
 * Exchange adds evergreen questions (with view counts) and its sites' popular
 * tags as seeds. The best English phrases are translated into other markets
 * (markets.ts) and read there, where the same demand often has far less supply.
 * Comments under the best gaps' top videos give viewer requests: videos people
 * asked for that nobody has made (requests.ts). New tools taking off on Hacker
 * News and GitHub become tutorial phrases before anyone has made the videos (launches.ts).
 *
 * Everything that touches YouTube goes through the scraper's gate (the caller
 * passes gated `suggest` and `search`), so the radar shares the scraper's rate
 * budget and circuit breaker and can't push the server's IP any harder. The
 * scraper calls the *Once methods a little each round.
 */

const DAY = 86_400_000;

export interface RadarDeps {
  radar: Pick<
    RadarRepository,
    "countKeywords" | "addKeywords" | "dueForExpansion" | "dueForResweep" | "dueForSupply" | "dueForDemand" | "dueForEase" | "update" | "markExpanded" | "top" | "addIdeas" | "ideas" | "lastIdeasAt" | "get" | "getMany" | "seededFrom" | "lastAddedAt" | "lastDemandAt"
    | "countDemandChecked"
  >;
  /** Autocomplete through the gate. */
  suggest?: (query: string) => Promise<Suggestion[]>;
  /** Scraped search through the gate, in the phrase's market; never the API's 100-unit search. */
  search?: (query: string, market: MarketCode) => Promise<YouTubeSearchResult[]>;
  /** A video's top comments, through the gate. */
  comments?: (videoId: string) => Promise<VideoComment[]>;
  /** Exact stats for the results (1 quota unit per 50 each). */
  youtube?: { getVideos(ids: readonly string[]): Promise<YouTubeVideo[]>; getChannels(ids: readonly string[]): Promise<YouTubeChannel[]> };
  demand?: Pick<DataForSeoClient, "searchVolume"> | null;
  reddit?: Pick<RedditClient, "sweep"> | null;
  stackexchange?: Pick<StackExchangeClient, "sweep"> | null;
  /** This week's Show HN posts and rising GitHub repos. */
  launches?: ((options: { signal?: AbortSignal; now?: Date }) => Promise<Launch[]>) | null;
  /** Games entering Steam's most-played chart and Roblox's Up-and-Coming and Trending sorts. */
  games?: ((options: { signal?: AbortSignal }) => Promise<RisingGame[]>) | null;
  ai?: Pick<TextProvider, "generateObject"> | null;
  seeds: readonly string[];
}

export interface RadarConfig {
  /** Re-read a phrase's results after this many days. */
  supplyRefreshDays: number;
  /** Re-fetch search volume and CPC after this many days. */
  demandRefreshDays: number;
  /** Ask DataForSEO at most this often. Each request costs the same up to 1,000 phrases. */
  demandEveryHours: number;
  /** Wait until this many phrases are due, so no request goes out half empty. */
  demandMinBatch: number;
  /**
   * Stop asking once this many phrases have had volume looked up. Each 1,000 is a
   * $0.09 request against a prepaid balance of about a dollar, so this is the spend cap.
   */
  demandBudgetPhrases: number;
  /** Autocomplete hops from a seed. */
  maxDepth: number;
  /** Stop growing the phrase list here. */
  maxKeywords: number;
  /** Collect Reddit at most this often. */
  redditEveryHours: number;
  /** Only phrases scoring at least this (before the AI rating) get one. */
  easeMinScore: number;
  /** Sweep each seed's autocomplete again after this many days; whatever is new since is a rising search. */
  resweepDays: number;
  /** Collect Stack Exchange at most this often. */
  stackEveryHours: number;
  /** Translate the best English phrases at most this often. */
  translateEveryHours: number;
  /** English phrases per translation batch (each becomes up to five). */
  translateBatch: number;
  /** Only English phrases scoring at least this get translated. */
  translateMinScore: number;
  /** Read viewer requests at most this often. */
  requestsEveryHours: number;
  /** Gaps whose top videos' comments are read per sweep (two videos each). */
  requestNiches: number;
  /** Read new launches at most this often. */
  launchesEveryHours: number;
  /** Read rising games at most this often. */
  gamesEveryHours: number;
}

export const DEFAULT_RADAR_CONFIG: RadarConfig = {
  supplyRefreshDays: 30,
  demandRefreshDays: 180,
  // Daily, so the first 5K phrases have volume within a week; the batch minimum and the
  // budget below keep it to a full $0.09 request at a time and about $0.72 in all.
  demandEveryHours: 24,
  demandMinBatch: 1_000,
  demandBudgetPhrases: 8_000,
  maxDepth: 2,
  maxKeywords: 60_000,
  redditEveryHours: 12,
  easeMinScore: 50,
  resweepDays: 7,
  stackEveryHours: 24,
  translateEveryHours: 24,
  translateBatch: 25,
  translateMinScore: 55,
  requestsEveryHours: 24,
  requestNiches: 15,
  launchesEveryHours: 7 * 24,
  gamesEveryHours: 24,
};

/** A rising game, with what YouTube looks like for it once the radar has checked. */
export interface RisingGameNiche {
  game: NicheIdeaRow;
  /** What people search for it. */
  phrase: string;
  niche: RadarNiche | null;
}

/** A phrase ready to show. */
export interface RadarNiche {
  keyword: string;
  seed: string;
  source: string;
  /** Search language; translations keep the English phrase they came from in `seed`. */
  market: MarketCode;
  category: NicheCategory | null;
  score: number;
  parts: RadarScore["parts"];
  format: RadarScore["format"];
  rpm: [number, number];
  supply: Supply;
  demand: Demand | null;
  ease: EaseRating | null;
  checkedAt: string | null;
}

export function toRadarNiche(row: NicheKeywordRow): RadarNiche | null {
  const supply = row.supply as unknown as Supply | null;
  const demand = row.demand as unknown as Demand | null;
  const ease = row.ease as unknown as EaseRating | null;
  const category = (row.category as NicheCategory | null) ?? categoryFor(row.keyword);
  const market = (row.market ?? "en") as MarketCode;
  const scored = scoreRadar({
    keyword: row.keyword,
    depth: row.depth,
    suggestRank: row.suggest_rank,
    category,
    supply,
    demand,
    ease,
    rising: row.source === "rising",
    rpmFactor: marketOf(market).rpmFactor,
  });
  if (!scored || !supply) return null;
  return {
    keyword: row.keyword,
    seed: row.seed,
    source: row.source,
    market,
    category,
    score: scored.total,
    parts: scored.parts,
    format: scored.format,
    rpm: scored.rpm,
    supply,
    demand,
    ease,
    checkedAt: row.supply_checked_at,
  };
}

const json = (value: unknown) => value as Json;

type KeywordInsert = TablesInsert<"niche_keywords">;

function withPriority(row: KeywordInsert): KeywordInsert {
  return { ...row, priority: priorityOf({ keyword: row.keyword, category: row.category ?? null, source: row.source ?? "autocomplete", depth: row.depth ?? 0, suggestRank: row.suggest_rank ?? null }) };
}

export class NicheRadarService {
  private readonly log: Logger;
  private readonly config: RadarConfig;
  private lastDemandAttempt = 0;
  private lastTranslateAttempt = 0;
  private lastRequestsAttempt = 0;
  private lastLaunchesAttempt = 0;
  private lastGamesAttempt = 0;

  constructor(
    private readonly deps: RadarDeps,
    config: Partial<RadarConfig> = {},
    logger?: Logger,
  ) {
    this.config = { ...DEFAULT_RADAR_CONFIG, ...config };
    this.log = logger ?? createLogger({ module: "services.niche_radar" });
  }

  /** The same radar with the scraping half attached (the scraper owns the gate's pace). */
  withScraping(extra: Pick<RadarDeps, "suggest" | "search" | "comments">): NicheRadarService {
    return new NicheRadarService({ ...this.deps, ...extra }, this.config, this.log);
  }

  /** Make sure every seed is on the list. Cheap: existing phrases are left alone. */
  async seed(): Promise<number> {
    return this.addSeeds(this.deps.seeds, "seed");
  }

  /**
   * More starting points: the library's best niches ("library") are topics already
   * proven on YouTube, and growing them through autocomplete finds the searches
   * around them nobody has made videos for yet.
   */
  async addSeeds(terms: readonly string[], source: string, category: NicheCategory | null = null): Promise<number> {
    const rows = [...new Set(terms.map(normalizeKeyword))]
      .filter((keyword) => keyword.length >= 3)
      .map((keyword) => withPriority({ keyword, seed: keyword, source, depth: 0, category: categoryFor(keyword) ?? category }));
    return this.deps.radar.addKeywords(rows);
  }

  /** Grow phrases through autocomplete. Spends at most about `maxQueries` requests. */
  async expandOnce(options: { maxQueries: number; signal?: AbortSignal; now?: Date }): Promise<{ queries: number; added: number; expanded: number; rising: number }> {
    const suggest = this.deps.suggest;
    const result = { queries: 0, added: 0, expanded: 0, rising: 0 };
    if (!suggest || options.maxQueries <= 0) return result;
    const now = options.now ?? new Date();

    // A couple of seeds a round are swept again, lightly: phrases that weren't in their
    // autocomplete last time are searches that just started, where nobody has caught up yet.
    const resweep = await this.deps.radar.dueForResweep(new Date(now.getTime() - this.config.resweepDays * DAY), 2);
    const full = (await this.deps.radar.countKeywords()) >= this.config.maxKeywords;
    const due = [...resweep, ...(full ? [] : await this.deps.radar.dueForExpansion(this.config.maxDepth - 1, 10))];
    const done: string[] = [];
    for (const row of due) {
      const again = row.expanded_at !== null;
      // New searches surface at the top of the base suggestions, so a re-sweep skips the a-z pass.
      const queries = expansionQueries(row.keyword, again ? 1 : row.depth);
      // Always finish a phrase once started (half-expanded phrases would never be revisited),
      // but don't start one the round's budget can't cover - unless it's the first.
      if (options.signal?.aborted || (result.queries > 0 && result.queries + queries.length > options.maxQueries)) break;
      const found = new Map<string, TablesInsert<"niche_keywords">>();
      for (const query of queries) {
        if (options.signal?.aborted) break;
        result.queries += 1;
        for (const s of await suggest(query)) {
          if (!isUsefulPhrase(s.phrase, row.keyword) || found.has(s.phrase)) continue;
          found.set(
            s.phrase,
            withPriority({
              keyword: s.phrase,
              seed: row.seed,
              source: again ? "rising" : "autocomplete",
              depth: row.depth + 1,
              suggest_rank: s.rank,
              category: categoryFor(s.phrase) ?? row.category,
            }),
          );
        }
      }
      if (options.signal?.aborted) break;
      const added = await this.deps.radar.addKeywords([...found.values()]);
      result.added += added;
      if (again) result.rising += added;
      done.push(row.keyword);
    }
    await this.deps.radar.markExpanded(done, now);
    result.expanded = done.length;
    return result;
  }

  /** Read what ranks for a few phrases and score them. */
  async checkSupplyOnce(options: { limit: number; signal?: AbortSignal; now?: Date }): Promise<{ checked: number; empty: number }> {
    const { search, youtube } = this.deps;
    const result = { checked: 0, empty: 0 };
    if (!search || !youtube || options.limit <= 0) return result;
    const now = options.now ?? new Date();
    const due = await this.deps.radar.dueForSupply(new Date(now.getTime() - this.config.supplyRefreshDays * DAY), options.limit);
    for (const row of due) {
      if (options.signal?.aborted) break;
      const found = await search(row.keyword, (row.market ?? "en") as MarketCode);
      const ids = [...new Set(found.filter((r) => r.kind === "video" || !r.kind).map((r) => r.id))].slice(0, 20);
      const videos = ids.length ? await youtube.getVideos(ids) : [];
      const channels = videos.length ? await youtube.getChannels([...new Set(videos.map((v) => v.channelId))]) : [];
      const supply = measureSupply(videos, channels, now);
      if (supply.results === 0) result.empty += 1;
      await this.save(row, { supply: json(supply), supply_checked_at: now.toISOString() });
      result.checked += 1;
    }
    return result;
  }

  /**
   * Search volume and CPC for up to 1,000 phrases in one request. Phrases are
   * asked about before their YouTube results are read, so the slow scraped
   * check goes to phrases people actually search.
   */
  async enrichDemandOnce(options: { limit?: number; signal?: AbortSignal; now?: Date } = {}): Promise<{ enriched: number }> {
    if (!this.deps.demand) return { enriched: 0 };
    const now = options.now ?? new Date();
    const every = this.config.demandEveryHours * 3_600_000;
    if (now.getTime() - this.lastDemandAttempt < every) return { enriched: 0 };
    // The saved time keeps the pace across restarts (every deploy restarts the scraper).
    const last = await this.deps.radar.lastDemandAt();
    if (last && now.getTime() - last.getTime() < every) return { enriched: 0 };
    if ((await this.deps.radar.countDemandChecked()) >= this.config.demandBudgetPhrases) return { enriched: 0 };
    const limit = options.limit ?? 1_000;
    const due = await this.deps.radar.dueForDemand(new Date(now.getTime() - this.config.demandRefreshDays * DAY), limit);
    // Every request costs the same, so it waits for a full one.
    if (due.length < Math.min(this.config.demandMinBatch, limit)) return { enriched: 0 };
    this.lastDemandAttempt = now.getTime();
    const demand = await this.deps.demand.searchVolume(
      due.map((r) => r.keyword),
      options.signal,
    );
    let enriched = 0;
    for (const row of due) {
      const d = demand.get(row.keyword) ?? null;
      // Phrases Google Ads didn't answer for still get a timestamp, so they aren't asked about every round.
      // Volume moves the phrase up or down the queue for its YouTube check.
      const priority = priorityOf({ keyword: row.keyword, category: row.category ?? null, source: row.source ?? "autocomplete", depth: row.depth ?? 0, suggestRank: row.suggest_rank ?? null, volume: d ? (d.volume ?? 0) : null });
      await this.save(row, { demand: d ? json(d) : row.demand, demand_checked_at: now.toISOString(), priority });
      if (d) enriched += 1;
    }
    return { enriched };
  }

  /** AI ease ratings and first-video ideas for the best unrated phrases. */
  async rateEaseOnce(options: { limit: number; now?: Date }): Promise<{ rated: number }> {
    if (!this.deps.ai || options.limit <= 0) return { rated: 0 };
    const now = options.now ?? new Date();
    const due = await this.deps.radar.dueForEase(options.limit, this.config.easeMinScore);
    const withTitles = due.filter((r) => ((r.supply as unknown as Supply | null)?.top.length ?? 0) > 0);
    for (const row of due.filter((r) => !withTitles.includes(r))) await this.deps.radar.update(row.keyword, { ease_checked_at: now.toISOString() });
    if (withTitles.length === 0) return { rated: 0 };

    const ratings = await rateEase(
      this.deps.ai,
      withTitles.map((row) => {
        const supply = row.supply as unknown as Supply;
        return { keyword: row.keyword, titles: supply.top.map((v) => v.title), shortsShare: supply.shortsShare, medianMinutes: supply.medianMinutes };
      }),
    );
    const byKeyword = new Map(ratings.map((r) => [r.keyword, r]));
    for (const row of withTitles) {
      const rating = byKeyword.get(row.keyword) ?? null;
      await this.save(row, { ease: rating ? json(rating) : null, ease_checked_at: now.toISOString() });
    }
    return { rated: ratings.length };
  }

  /** This week's top posts from high-paying communities: ideas, plus the topics they keep coming back to as new phrases. */
  async collectRedditOnce(options: { signal?: AbortSignal; now?: Date } = {}): Promise<{ posts: number; phrases: number } | null> {
    if (!this.deps.reddit) return null;
    const now = options.now ?? new Date();
    const last = await this.deps.radar.lastIdeasAt("reddit");
    if (last && now.getTime() - last.getTime() < this.config.redditEveryHours * 3_600_000) return null;

    const posts = await this.deps.reddit.sweep(Object.keys(SUBREDDITS), { signal: options.signal, period: "week" });
    const saved = await this.deps.radar.addIdeas(
      posts.map((p) => ({
        source: "reddit",
        community: p.community,
        title: p.title,
        url: p.url,
        score: p.score,
        comments: p.comments,
        posted_at: p.postedAt,
        kind: p.kind,
        category: p.category,
        collected_at: now.toISOString(),
      })),
    );
    const phrases = await this.phrasesFromPosts(posts);
    this.log.info("reddit collected", { posts: saved, phrases });
    return { posts: saved, phrases };
  }

  /**
   * Stack Exchange once a day: the month's and all time's most-voted questions as
   * ideas (with how many times each was read), and each site's popular tags as seeds.
   */
  async collectStackOnce(options: { signal?: AbortSignal; now?: Date } = {}): Promise<{ questions: number; seeds: number } | null> {
    if (!this.deps.stackexchange) return null;
    const now = options.now ?? new Date();
    const last = await this.deps.radar.lastIdeasAt("stackexchange");
    if (last && now.getTime() - last.getTime() < this.config.stackEveryHours * 3_600_000) return null;

    const { questions, tags } = await this.deps.stackexchange.sweep(Object.keys(STACK_SITES), { signal: options.signal, withTags: true });
    const saved = await this.deps.radar.addIdeas(
      questions.map((q) => ({
        source: "stackexchange",
        community: q.community,
        title: q.title,
        url: q.url,
        score: q.score,
        comments: q.answers,
        views: q.views,
        posted_at: q.postedAt,
        kind: "question",
        category: q.category,
        collected_at: now.toISOString(),
      })),
    );
    let seeds = 0;
    for (const { site, tags: names } of tags) seeds += await this.addSeeds(names, "stackexchange", STACK_SITES[site] ?? null);
    this.log.info("stack exchange collected", { questions: saved, seeds });
    return { questions: saved, seeds };
  }

  /**
   * The best English phrases, translated into the other markets once a day. Each
   * translation is its own phrase, read in its own language and country; it isn't
   * grown through autocomplete (that's English-only), so it starts at the deepest level.
   */
  async translateOnce(options: { now?: Date } = {}): Promise<{ phrases: number; added: number } | null> {
    if (!this.deps.ai) return null;
    const now = options.now ?? new Date();
    const every = this.config.translateEveryHours * 3_600_000;
    // The attempt clock covers batches that added nothing (every translation already known), which leave no row to date.
    if (now.getTime() - this.lastTranslateAttempt < every) return null;
    const last = await this.deps.radar.lastAddedAt("translation");
    if (last && now.getTime() - last.getTime() < every) return null;
    this.lastTranslateAttempt = now.getTime();
    const best = await this.deps.radar.top({ limit: this.config.translateBatch * 4, minScore: this.config.translateMinScore, market: "en" });
    const done = await this.deps.radar.seededFrom(
      "translation",
      best.map((r) => r.keyword),
    );
    const batch = best.filter((r) => !done.has(r.keyword)).slice(0, this.config.translateBatch);
    if (batch.length === 0) return null;
    const byKeyword = new Map(batch.map((r) => [r.keyword, r]));
    try {
      const translations = await translatePhrases(
        this.deps.ai,
        batch.map((r) => r.keyword),
      );
      const rows = translations.map((t) =>
        withPriority({
          keyword: t.phrase,
          seed: t.english,
          source: "translation",
          market: t.market,
          depth: this.config.maxDepth,
          category: byKeyword.get(t.english)?.category ?? categoryFor(t.english),
          discovered_at: now.toISOString(),
        }),
      );
      const added = await this.deps.radar.addKeywords(rows);
      this.log.info("radar phrases translated", { phrases: batch.length, added });
      return { phrases: batch.length, added };
    } catch (error) {
      this.log.warn("radar translation failed", { error });
      return null;
    }
  }

  /**
   * Viewer requests under the best gaps' top videos, once a day: two comment
   * pages per niche through the gate, then one model call to pull out the
   * videos people asked for.
   */
  async collectRequestsOnce(options: { signal?: AbortSignal; now?: Date } = {}): Promise<{ niches: number; requests: number } | null> {
    const { comments, ai } = this.deps;
    if (!comments || !ai) return null;
    const now = options.now ?? new Date();
    const every = this.config.requestsEveryHours * 3_600_000;
    if (now.getTime() - this.lastRequestsAttempt < every) return null;
    const last = await this.deps.radar.lastIdeasAt("comments");
    if (last && now.getTime() - last.getTime() < every) return null;
    this.lastRequestsAttempt = now.getTime();

    const best = (await this.deps.radar.top({ limit: this.config.requestNiches * 2, minScore: 60, market: "en" }))
      .filter((r) => ((r.supply as unknown as Supply | null)?.top.length ?? 0) > 0)
      .slice(0, this.config.requestNiches);
    const groups: { niche: string; comments: VideoComment[] }[] = [];
    for (const row of best) {
      if (options.signal?.aborted) break;
      const videos = (row.supply as unknown as Supply).top.slice(0, 2);
      const found: VideoComment[] = [];
      try {
        for (const video of videos) found.push(...(await comments(video.id)));
      } catch (error) {
        // A refusal trips the gate's breaker; whatever was read so far still counts.
        this.log.warn("comment read failed", { keyword: row.keyword, error });
        break;
      }
      groups.push({ niche: row.keyword, comments: found });
    }
    if (groups.length === 0) return { niches: 0, requests: 0 };
    try {
      const requests = await extractRequests(ai, groups);
      const category = new Map(best.map((r) => [r.keyword, r.category]));
      const saved = await this.deps.radar.addIdeas(
        requests.map((r) => ({
          source: "comments",
          community: r.niche,
          title: r.title,
          url: r.url,
          score: r.likes,
          comments: r.asks,
          kind: "request",
          category: category.get(r.niche) ?? categoryFor(r.niche),
          collected_at: now.toISOString(),
        })),
      );
      this.log.info("viewer requests collected", { niches: groups.length, requests: saved });
      return { niches: groups.length, requests: saved };
    } catch (error) {
      this.log.warn("viewer request extraction failed", { error });
      return null;
    }
  }

  /**
   * New tools, once a week: the AI keeps the launches ordinary people will want
   * tutorials for, and each becomes a phrase (grown a little through autocomplete,
   * like Reddit's) and an idea linking back to the launch.
   */
  async collectLaunchesOnce(options: { signal?: AbortSignal; now?: Date } = {}): Promise<{ launches: number; phrases: number } | null> {
    const { launches, ai } = this.deps;
    if (!launches || !ai) return null;
    const now = options.now ?? new Date();
    const every = this.config.launchesEveryHours * 3_600_000;
    if (now.getTime() - this.lastLaunchesAttempt < every) return null;
    const last = await this.deps.radar.lastIdeasAt("launches");
    if (last && now.getTime() - last.getTime() < every) return null;
    this.lastLaunchesAttempt = now.getTime();
    try {
      const found = await launches({ signal: options.signal, now });
      const picked = await launchPhrases(ai, found);
      const phrases = await this.deps.radar.addKeywords(
        picked.map((p) => withPriority({ keyword: p.phrase, seed: p.name.toLowerCase().slice(0, 80), source: "launch", depth: 1, category: "Science & Tech" })),
      );
      await this.deps.radar.addIdeas(
        picked.map((p) => ({
          source: "launches",
          community: p.phrase,
          title: p.name,
          url: p.url,
          score: p.score,
          kind: "launch",
          category: "Science & Tech",
          collected_at: now.toISOString(),
        })),
      );
      this.log.info("launches collected", { launches: found.length, picked: picked.length, phrases });
      return { launches: found.length, phrases };
    } catch (error) {
      this.log.warn("launch collection failed", { error });
      return null;
    }
  }

  /**
   * Rising games, once a day: each becomes a seed (grown through autocomplete into
   * "huss valley tips", "huss valley secrets") and an idea row with its player count.
   * Seeds are checked first (priority.ts), so within a day the board shows whether
   * YouTube has caught up with the game yet.
   */
  async collectGamesOnce(options: { signal?: AbortSignal; now?: Date } = {}): Promise<{ games: number; seeds: number } | null> {
    const { games } = this.deps;
    if (!games) return null;
    const now = options.now ?? new Date();
    const every = this.config.gamesEveryHours * 3_600_000;
    if (now.getTime() - this.lastGamesAttempt < every) return null;
    const last = await this.deps.radar.lastIdeasAt("games");
    if (last && now.getTime() - last.getTime() < every) return null;
    this.lastGamesAttempt = now.getTime();
    try {
      const found = (await games({ signal: options.signal })).filter((g) => gameSearchPhrase(g).length >= 3);
      const seeds = await this.deps.radar.addKeywords(
        found.map((g) => {
          const keyword = gameSearchPhrase(g);
          return withPriority({ keyword, seed: keyword, source: "game", depth: 0, category: "Gaming" });
        }),
      );
      await this.deps.radar.addIdeas(
        found.map((g) => ({
          source: "games",
          community: g.platform,
          title: g.name,
          url: g.url,
          score: g.players,
          // Places climbed on Steam's chart this week.
          comments: g.rank !== null && g.lastWeekRank !== null ? g.lastWeekRank - g.rank : 0,
          views: g.players,
          kind: g.reason,
          category: "Gaming",
          collected_at: now.toISOString(),
        })),
      );
      this.log.info("rising games collected", { games: found.length, seeds });
      return { games: found.length, seeds };
    } catch (error) {
      this.log.warn("rising games failed", { error });
      return null;
    }
  }

  /** Turn the week's most-discussed posts into searchable niche phrases (AI), and add the new ones. */
  private async phrasesFromPosts(posts: readonly RedditPost[]): Promise<number> {
    if (!this.deps.ai || posts.length === 0) return 0;
    const best = [...posts].sort((a, b) => b.score + b.comments * 3 - (a.score + a.comments * 3)).slice(0, 120);
    try {
      const { object } = await this.deps.ai.generateObject({
        system: PHRASES_PROMPT,
        messages: [{ role: "user", content: best.map((p) => `${p.community}: ${p.title}`).join("\n") }],
        schema: phrasesSchema,
        schemaName: "reddit_niche_phrases",
        maxOutputTokens: 1_500,
        effort: "low",
      });
      const rows = object.phrases
        .map((p) => ({ phrase: normalizeKeyword(p.phrase), community: p.community.replace(/^r\//i, "").toLowerCase() }))
        .filter((p) => p.phrase.split(" ").length >= 2 && p.phrase.split(" ").length <= 6)
        .map((p) =>
          withPriority({
            keyword: p.phrase,
            seed: `r/${p.community}`,
            source: "reddit",
            depth: 1,
            category: categoryFor(p.phrase) ?? SUBREDDITS[p.community] ?? null,
          }),
        );
      return this.deps.radar.addKeywords(rows);
    } catch (error) {
      this.log.warn("reddit phrase extraction failed", { error });
      return 0;
    }
  }

  private async save(row: NicheKeywordRow, patch: Partial<NicheKeywordRow>): Promise<void> {
    const next = { ...row, ...patch };
    const scored = toRadarNiche(next);
    await this.deps.radar.update(row.keyword, { ...patch, score: scored ? scored.score : null });
  }

  /** The best phrases, ready to show. */
  async list(options: { limit?: number; category?: string | null } = {}): Promise<RadarNiche[]> {
    const rows = await this.deps.radar.top({ limit: options.limit ?? 200, category: options.category });
    return rows.flatMap((row) => {
      const niche = toRadarNiche(row);
      return niche ? [niche] : [];
    });
  }

  /** This week's rising games: checked ones with the most room first, then the rest by players. */
  async risingGames(options: { limit?: number; now?: Date } = {}): Promise<RisingGameNiche[]> {
    // Each sweep refreshes a game's row, so three days covers the current lists.
    const rows = await this.ideas({ source: "games", days: 3, limit: 150, now: options.now });
    const phrases = rows.map((g) => gameSearchPhrase({ platform: g.community === "roblox" ? "roblox" : "steam", name: g.title }));
    const checked = new Map((await this.deps.radar.getMany(phrases)).map((r) => [r.keyword, toRadarNiche(r)]));
    return rows
      .map((game, i) => ({ game, phrase: phrases[i]!, niche: checked.get(phrases[i]!) ?? null }))
      .sort((a, b) => (b.niche?.score ?? -1) - (a.niche?.score ?? -1) || b.game.score - a.game.score)
      .slice(0, options.limit ?? 18);
  }

  async ideas(
    options: { limit?: number; days?: number; kind?: string; source?: string; category?: string | null; orderBy?: "score" | "views"; now?: Date } = {},
  ): Promise<NicheIdeaRow[]> {
    const now = options.now ?? new Date();
    return this.deps.radar.ideas({
      limit: options.limit ?? 30,
      since: new Date(now.getTime() - (options.days ?? 14) * DAY),
      kind: options.kind,
      source: options.source,
      category: options.category,
      orderBy: options.orderBy,
    });
  }

  /** Phrases good enough to grow the channel library around. */
  async growthSeeds(limit: number): Promise<string[]> {
    // The library grows through English searches.
    const [rows, games] = await Promise.all([
      this.deps.radar.top({ limit, minScore: 60, market: "en" }).catch(() => []),
      // This week's rising games, so the channels already covering them get tracked too.
      this.deps.radar.ideas({ limit: 15, since: new Date(Date.now() - 7 * DAY), source: "games" }).catch(() => []),
    ]);
    const fromGames = games.map((g) => gameSearchPhrase({ platform: g.community === "roblox" ? "roblox" : "steam", name: g.title }));
    return [...new Set([...fromGames, ...rows.map((r) => r.keyword)])];
  }
}

const phrasesSchema = z.object({
  phrases: z.array(z.object({ phrase: z.string(), community: z.string() })),
});

const PHRASES_PROMPT = `You find YouTube niches in Reddit posts for Outlier, a research tool for creators.

You get this week's most-discussed post titles, each prefixed with its community. Return up to 40 search phrases (2-5 words) that a YouTube channel could be built around, the way someone would type them into YouTube: "roth ira for beginners", "chatgpt for excel", "credit card churning". Prefer specific, recurring topics over one-off news. Skip people's names, single events, and anything that only makes sense inside the post. Give each phrase the community it came from.`;
