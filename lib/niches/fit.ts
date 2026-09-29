import type { NicheMetrics } from "./analysis";

/** The creator's own channel, over the same 30-day window the niche's numbers use. */
export interface OwnChannelMonth {
  title: string;
  subscribers: number | null;
  /** Views on uploads from the last 30 days. */
  monthViews: number;
  uploads30d: number;
  /** Median views per upload, recent uploads. */
  medianViews: number;
}

export interface FitRow {
  key: "monthly" | "perUpload" | "pace";
  label: string;
  you: number;
  them: number;
  /** What `them` is, in words ("typical channel here"). */
  themLabel: string;
  /** you / them, or null when there's nothing to compare against. */
  ratio: number | null;
}

export interface NicheFit {
  verdict: "ahead" | "close" | "stretch";
  headline: string;
  rows: FitRow[];
  /** One line about whether channels this size break out here. */
  sizeNote: string | null;
}

const SMALL_CHANNEL_SUBS = 100_000;

/**
 * How the creator's channel compares with a typical channel in the niche. Only
 * views and pace, which both sides have measured the same way; nothing here
 * predicts what the channel would do after switching.
 */
export function nicheFit(metrics: NicheMetrics, own: OwnChannelMonth): NicheFit | null {
  const typicalMonth = metrics.monthlyViews?.typical ?? 0;
  if (typicalMonth <= 0 && metrics.medianViews <= 0) return null;

  const pace = metrics.activeChannels > 0 ? metrics.uploads30d / metrics.activeChannels : 0;
  const row = (key: FitRow["key"], label: string, you: number, them: number, themLabel: string): FitRow => ({
    key,
    label,
    you,
    them,
    themLabel,
    ratio: them > 0 ? you / them : null,
  });
  const rows = [
    row("monthly", "Views a month", own.monthViews, typicalMonth, "typical channel here"),
    row("perUpload", "Views per upload", own.medianViews, metrics.medianViews, "typical upload here"),
    row("pace", "Uploads a month", own.uploads30d, Math.round(pace * 10) / 10, "typical channel here"),
  ].filter((r) => r.them > 0);

  const monthly = rows.find((r) => r.key === "monthly")?.ratio ?? rows.find((r) => r.key === "perUpload")?.ratio ?? null;
  const verdict: NicheFit["verdict"] = monthly === null ? "close" : monthly >= 1 ? "ahead" : monthly >= 0.4 ? "close" : "stretch";
  const headline =
    verdict === "ahead"
      ? "You already pull more views than a typical channel here."
      : verdict === "close"
        ? "You're in range of a typical channel here."
        : `A typical channel here gets about ${Math.round(1 / (monthly ?? 1))}× your monthly views.`;

  const small = metrics.smallChannelShare;
  const isSmall = own.subscribers !== null && own.subscribers < SMALL_CHANNEL_SUBS;
  const sizeNote =
    small === null
      ? null
      : isSmall && small >= 0.5
        ? `${Math.round(small * 100)}% of breakouts here come from channels under 100K, so a channel your size can break out.`
        : isSmall && small < 0.25
          ? `Only ${Math.round(small * 100)}% of breakouts here come from channels under 100K. Bigger channels win most of them.`
          : !isSmall
            ? `${Math.round(small * 100)}% of breakouts here come from channels under 100K.`
            : null;

  return { verdict, headline, rows, sizeNote };
}
