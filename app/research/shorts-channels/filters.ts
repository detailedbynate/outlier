import type { ShortsChannelFilters } from "@/lib/database/repositories/channels";
import { daysAgo } from "@/lib/format";

/** URL state for the Shorts Channels page. Every filter is a short query param with "any" as the default. */

type Option = { key: string; label: string };

export const SUBSCRIBERS = [
  { key: "any", label: "Any size" },
  { key: "u10k", label: "Under 10K", max: 10_000 },
  { key: "10k-100k", label: "10K–100K", min: 10_000, max: 100_000 },
  { key: "100k-1m", label: "100K–1M", min: 100_000, max: 1_000_000 },
  { key: "1m", label: "1M+", min: 1_000_000 },
] satisfies (Option & { min?: number; max?: number })[];

export const AVG_VIEWS = [
  { key: "any", label: "Any views" },
  { key: "10k", label: "10K+ avg", min: 10_000 },
  { key: "100k", label: "100K+ avg", min: 100_000 },
  { key: "1m", label: "1M+ avg", min: 1_000_000 },
] satisfies (Option & { min?: number })[];

export const CHANNEL_AGE = [
  { key: "any", label: "Any age" },
  { key: "30d", label: "Under 30 days", days: 30 },
  { key: "90d", label: "Under 3 months", days: 90 },
  { key: "6m", label: "Under 6 months", days: 182 },
  { key: "1y", label: "Under 1 year", days: 365 },
] satisfies (Option & { days?: number })[];

export const ACTIVITY = [
  { key: "any", label: "Any activity" },
  { key: "3d", label: "Posted in 3 days", days: 3 },
  { key: "7d", label: "Posted in 7 days", days: 7 },
  { key: "30d", label: "Posted in 30 days", days: 30 },
] satisfies (Option & { days?: number })[];

export const MARKETS = [
  { key: "en", label: "English markets" },
  { key: "any", label: "Any language / country" },
] satisfies Option[];

export const SHORTS_SHARE = [
  { key: "any", label: "60%+ Shorts" },
  { key: "80", label: "80%+ Shorts", min: 0.8 },
  { key: "95", label: "Shorts only (95%+)", min: 0.95 },
] satisfies (Option & { min?: number })[];

export const COUNTRIES = [
  { key: "any", label: "Any country" },
  ...["US", "GB", "CA", "AU", "IN", "BR", "MX", "DE", "FR", "ES", "IT", "PH", "ID", "JP", "KR"].map((code) => ({ key: code, label: code })),
] satisfies Option[];

export const SORTS = [
  { key: "views", label: "Avg views", column: "avg_short_views", group: "Channel" },
  { key: "subs", label: "Subscribers", column: "subscriber_count", group: "Channel" },
  { key: "momentum", label: "Most active", column: "shorts_last_30d", group: "Channel" },
  { key: "newest", label: "Newest channels", column: "channel_created_at", group: "Channel" },
  { key: "recent", label: "Latest upload", column: "last_short_at", group: "Channel" },
  { key: "outlier", label: "Outlier multiplier", column: "top_multiplier", group: "Signals" },
  { key: "hits", label: "Hit rate", column: "hit_rate", group: "Signals" },
  { key: "engagement", label: "Engagement", column: "avg_engagement", group: "Signals" },
  { key: "pace", label: "Shorts per week", column: "shorts_per_week", group: "Signals" },
  { key: "vph", label: "Views per hour", column: "recent_vph", group: "Realtime" },
  { key: "views24", label: "Views · last 24h", column: "views_24h", group: "Realtime" },
  { key: "views48", label: "Views · last 48h", column: "views_48h", group: "Realtime" },
  { key: "subs24", label: "Subs · last 24h", column: "subs_24h", group: "Realtime" },
  { key: "subs48", label: "Subs · last 48h", column: "subs_48h", group: "Realtime" },
] satisfies (Option & { column: ShortsChannelFilters["orderBy"]; group: SortGroup })[];

export type SortGroup = "Channel" | "Signals" | "Realtime";
export const SORT_GROUPS: { key: SortGroup; label: string }[] = [
  { key: "Channel", label: "Channel stats" },
  { key: "Signals", label: "Outlier signals" },
  { key: "Realtime", label: "Realtime growth" },
];

export function isRealtimeSort(key: string): boolean {
  return SORTS.some((s) => s.key === key && s.group === "Realtime");
}

export const PAGE_SIZE = 30;
export const MAX_LIMIT = 120;

export interface ShortsPageState {
  q: string;
  sort: string;
  subs: string;
  views: string;
  age: string;
  active: string;
  share: string;
  country: string;
  tracked: string;
  market: string;
  videos: string;
  limit: string;
}

const DEFAULTS: ShortsPageState = {
  q: "",
  sort: "views",
  subs: "any",
  views: "any",
  age: "any",
  active: "any",
  share: "any",
  country: "any",
  tracked: "any",
  market: "en",
  videos: "show",
  limit: String(PAGE_SIZE),
};

/** Filters counted on the "Advanced Filters" badge. */
export const ADVANCED_KEYS = ["subs", "views", "age", "active", "share", "country", "tracked", "market"] as const;

export const QUICK_FILTERS: { key: string; label: string; description: string; params: Partial<ShortsPageState> }[] = [
  { key: "rising", label: "Rising new channels", description: "Under 3 months old, 10K+ avg views", params: { age: "90d", views: "10k" } },
  { key: "small-viral", label: "Small channels, big views", description: "Under 10K subs, 100K+ avg views", params: { subs: "u10k", views: "100k" } },
  { key: "consistent", label: "Posting consistently", description: "Posted this week, sorted by activity", params: { active: "7d", sort: "momentum" } },
  { key: "big", label: "Big Shorts channels", description: "1M+ subscribers", params: { subs: "1m" } },
  { key: "tracked", label: "My tracked channels", description: "Channels you bookmarked", params: { tracked: "yes" } },
];

function pickKey(options: readonly Option[], value: unknown): string {
  return options.some((o) => o.key === value) ? (value as string) : options[0]!.key;
}

export function parseState(params: Record<string, string | string[] | undefined>): ShortsPageState {
  const str = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);
  const limit = Number(str("limit"));
  return {
    q: (str("q") ?? "").trim().slice(0, 150),
    sort: pickKey(SORTS, str("sort")),
    subs: pickKey(SUBSCRIBERS, str("subs")),
    views: pickKey(AVG_VIEWS, str("views")),
    age: pickKey(CHANNEL_AGE, str("age")),
    active: pickKey(ACTIVITY, str("active")),
    share: pickKey(SHORTS_SHARE, str("share")),
    country: pickKey(COUNTRIES, str("country")),
    tracked: str("tracked") === "yes" ? "yes" : "any",
    market: pickKey(MARKETS, str("market")),
    videos: str("videos") === "hide" ? "hide" : "show",
    limit: String(Number.isInteger(limit) && limit >= PAGE_SIZE && limit <= MAX_LIMIT ? limit : PAGE_SIZE),
  };
}

/** `targetCountries` come from the OUTLIER_COUNTRIES setting. */
export function toFilters(state: ShortsPageState, targetCountries: readonly string[] = []): Omit<ShortsChannelFilters, "channelIds"> {
  const find = <T extends Option>(options: readonly T[], key: string) => options.find((o) => o.key === key)!;
  const subs = find(SUBSCRIBERS, state.subs) as { min?: number; max?: number };
  const views = find(AVG_VIEWS, state.views) as { min?: number };
  const age = find(CHANNEL_AGE, state.age) as { days?: number };
  const active = find(ACTIVITY, state.active) as { days?: number };
  const share = find(SHORTS_SHARE, state.share) as { min?: number };
  return {
    minSubscribers: subs.min,
    maxSubscribers: subs.max,
    minAvgViews: views.min,
    createdAfter: age.days ? daysAgo(age.days) : undefined,
    activeSince: active.days ? daysAgo(active.days) : undefined,
    minShortsShare: share.min,
    country: state.country === "any" ? undefined : state.country,
    tracked: state.tracked === "yes" ? true : undefined,
    // A specific country choice overrides the market filter's country list.
    targetMarket: state.market === "en" ? { countries: state.country === "any" ? targetCountries : [] } : undefined,
    orderBy: find(SORTS, state.sort).column,
    limit: Number(state.limit),
  };
}

/** Build a page URL from the current state plus overrides, omitting defaults. */
export function buildHref(state: ShortsPageState, overrides: Partial<ShortsPageState> = {}): string {
  const next = { ...state, ...overrides };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(next) as [keyof ShortsPageState, string][]) {
    if (value && value !== DEFAULTS[key]) params.set(key, value);
  }
  const qs = params.toString();
  return `/research/shorts-channels${qs ? `?${qs}` : ""}`;
}

export function countAdvanced(state: ShortsPageState): number {
  return ADVANCED_KEYS.filter((key) => state[key] !== DEFAULTS[key]).length;
}

/** Reset every advanced filter (keeps search, sort, and view options). */
export function clearedAdvanced(): Partial<ShortsPageState> {
  return Object.fromEntries(ADVANCED_KEYS.map((key) => [key, DEFAULTS[key]]));
}

export function activeQuickFilter(state: ShortsPageState) {
  return QUICK_FILTERS.find((preset) => {
    const expected = { ...clearedAdvanced(), sort: DEFAULTS.sort, ...preset.params };
    return (Object.keys(expected) as (keyof ShortsPageState)[]).every((key) => state[key] === expected[key]);
  });
}

export function label(options: readonly Option[], key: string): string {
  return options.find((o) => o.key === key)?.label ?? key;
}
