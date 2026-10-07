/**
 * Demand and pay for search phrases, from Google Ads data through DataForSEO.
 *
 * Cost-per-click is the closest public number to RPM: advertisers bid on what
 * pays them, and YouTube ads in a niche are priced off the same auction. So a
 * phrase's CPC ranks niches within a category ("credit card churning" vs
 * "budgeting"), which the per-category RPM table can't.
 *
 * One request covers up to 1,000 phrases for a few cents. Off unless
 * DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are set.
 */

export interface Demand {
  /** Average monthly Google searches (US). */
  volume: number | null;
  /** Average cost per click in USD. */
  cpc: number | null;
  /** Google Ads competition, 0-100. */
  competition: number | null;
  /** Last three months vs the same months a year earlier (0.4 = +40%); null without the history. */
  trend: number | null;
  /** Month (1-12) with the most searches, for seasonal niches. */
  peakMonth: number | null;
  source: "dataforseo";
}

interface MonthlySearch {
  year: number;
  month: number;
  search_volume: number | null;
}

interface ResultRow {
  keyword: string;
  search_volume: number | null;
  cpc: number | null;
  competition_index: number | null;
  monthly_searches: MonthlySearch[] | null;
}

/** Year-over-year change of the latest three months. */
export function trendOf(monthly: readonly MonthlySearch[] | null): { trend: number | null; peakMonth: number | null } {
  if (!monthly || monthly.length < 15) return { trend: null, peakMonth: peakOf(monthly) };
  const sorted = [...monthly].filter((m) => m.search_volume !== null).sort((a, b) => b.year - a.year || b.month - a.month);
  const recent = sorted.slice(0, 3);
  const before = recent.map((r) => sorted.find((m) => m.year === r.year - 1 && m.month === r.month));
  if (before.some((b) => !b)) return { trend: null, peakMonth: peakOf(monthly) };
  const now = recent.reduce((sum, m) => sum + (m.search_volume ?? 0), 0);
  const then = before.reduce((sum, m) => sum + (m!.search_volume ?? 0), 0);
  return { trend: then > 0 ? Math.round(((now - then) / then) * 100) / 100 : null, peakMonth: peakOf(monthly) };
}

function peakOf(monthly: readonly MonthlySearch[] | null): number | null {
  if (!monthly?.length) return null;
  const byMonth = new Map<number, number>();
  for (const m of monthly) byMonth.set(m.month, (byMonth.get(m.month) ?? 0) + (m.search_volume ?? 0));
  const values = [...byMonth.values()];
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const [month, top] = [...byMonth.entries()].sort((a, b) => b[1] - a[1])[0]!;
  // Only call it seasonal when one month clearly stands out.
  return top >= avg * 1.5 ? month : null;
}

export function parseDemand(body: unknown): Map<string, Demand> {
  const out = new Map<string, Demand>();
  const tasks = (body as { tasks?: { status_code?: number; result?: ResultRow[] | null }[] })?.tasks ?? [];
  for (const task of tasks) {
    for (const row of task.result ?? []) {
      if (!row?.keyword) continue;
      const { trend, peakMonth } = trendOf(row.monthly_searches);
      out.set(row.keyword.toLowerCase(), {
        volume: row.search_volume ?? null,
        cpc: row.cpc === null || row.cpc === undefined ? null : Math.round(row.cpc * 100) / 100,
        competition: row.competition_index ?? null,
        trend,
        peakMonth,
        source: "dataforseo",
      });
    }
  }
  return out;
}

/** Google Ads refuses phrases with symbols or more than ten words; send only what it accepts. */
export function acceptableForAds(keyword: string): boolean {
  return keyword.length <= 80 && keyword.split(" ").length <= 10 && /^[\p{L}\p{N}\s'-]+$/u.test(keyword);
}

export class DataForSeoClient {
  constructor(
    private readonly credentials: { login: string; password: string },
    private readonly options: { locationCode?: number; languageCode?: string; fetch?: typeof fetch } = {},
  ) {}

  async searchVolume(keywords: readonly string[], signal?: AbortSignal): Promise<Map<string, Demand>> {
    const list = [...new Set(keywords.filter(acceptableForAds))].slice(0, 1_000);
    if (list.length === 0) return new Map();
    const auth = Buffer.from(`${this.credentials.login}:${this.credentials.password}`).toString("base64");
    const response = await (this.options.fetch ?? fetch)("https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live", {
      method: "POST",
      headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
      body: JSON.stringify([{ keywords: list, location_code: this.options.locationCode ?? 2840, language_code: this.options.languageCode ?? "en" }]),
      signal: signal ?? AbortSignal.timeout(90_000),
    });
    if (!response.ok) throw new Error(`DataForSEO search volume failed (${response.status})`);
    return parseDemand(await response.json());
  }
}
