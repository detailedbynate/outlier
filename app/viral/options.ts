/** The Viral Videos filters, shared by the page (which loads with them) and the bar (which sets them). */

export const RANGES = [
  { key: "1", label: "24 hours" },
  { key: "2", label: "48 hours" },
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "all", label: "All time" },
] as const;

export const FORMATS = [
  { key: "all", label: "All" },
  { key: "long_form", label: "Videos" },
  { key: "short", label: "Shorts" },
] as const;

export const SORTS = [
  { key: "outlier_score", label: "Outlier score" },
  { key: "views_per_day", label: "Views / day" },
  { key: "view_count", label: "Total views" },
] as const;

export type TermParam = "style" | "hook" | "angle";

export interface ViralState {
  range: (typeof RANGES)[number]["key"];
  format: (typeof FORMATS)[number]["key"];
  sort: (typeof SORTS)[number]["key"];
  style: string;
  hook: string;
  angle: string;
}

function pick<T extends readonly { key: string }[]>(options: T, value: unknown, fallback: T[number]["key"]): T[number]["key"] {
  return options.some((o) => o.key === value) ? (value as T[number]["key"]) : fallback;
}

/** Reads the filters from the URL, dropping anything unknown. */
export function readState(get: (key: string) => unknown, isTerm: (param: TermParam, key: string) => boolean): ViralState {
  const term = (param: TermParam) => {
    const value = get(param);
    return typeof value === "string" && isTerm(param, value) ? value : "";
  };
  return {
    range: pick(RANGES, get("range"), "30"),
    format: pick(FORMATS, get("format"), "all"),
    sort: pick(SORTS, get("sort"), "outlier_score"),
    style: term("style"),
    hook: term("hook"),
    angle: term("angle"),
  };
}

export function viralHref(state: ViralState, overrides: Partial<ViralState> = {}): string {
  const next = new URLSearchParams({ ...state, ...overrides });
  for (const [key, value] of [...next.entries()]) if (!value) next.delete(key);
  return `/viral?${next.toString()}`;
}
