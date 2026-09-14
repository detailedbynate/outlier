/** Display formatting helpers shared by UI pages. */

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("en-US");

export function formatCompact(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : compact.format(value);
}

export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : full.format(Math.round(value));
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(digits)}%`;
}

export function formatMultiplier(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)}×`;
}

export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

export function timeAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "never";
  const seconds = Math.max(0, (now.getTime() - Date.parse(iso)) / 1000);
  const units: [number, string][] = [
    [31_536_000, "y"],
    [2_592_000, "mo"],
    [86_400, "d"],
    [3_600, "h"],
    [60, "m"],
  ];
  for (const [size, label] of units) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${label} ago`;
  }
  return "just now";
}

/** The date `days` days before now (for query filters). */
export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

/** Hours elapsed since an ISO timestamp (NaN when unparseable). */
export function hoursSince(iso: string, now: Date = new Date()): number {
  return (now.getTime() - Date.parse(iso)) / 3_600_000;
}
