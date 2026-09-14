/* eslint-disable @next/next/no-img-element -- YouTube avatars are already CDN-optimized */
import type { Metadata } from "next";
import Link from "next/link";
import { UsersIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { bestIndex, competitorAverage, STAT_ROWS, type ChannelStats, type StatKey } from "@/lib/analytics/compare";
import { requireApprovedUser } from "@/lib/auth/session";
import { isAppError } from "@/lib/core/errors";
import { formatCompact, formatPercent } from "@/lib/format";
import { getServices } from "@/lib/services";
import { MAX_COMPETITORS_COMPARED, type ComparedChannel } from "@/lib/services/compare-service";
import { asUser } from "@/lib/youtube/quota-context";

export const dynamic = "force-dynamic";
// First comparisons sync channels from YouTube.
export const maxDuration = 60;
export const metadata: Metadata = { title: "You vs Competitors · Outlier" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function formatStat(value: number | null, kind: (typeof STAT_ROWS)[number]["kind"]): string {
  if (value === null) return "—";
  switch (kind) {
    case "percent":
      return formatPercent(value);
    case "multiplier":
      return `${value >= 10 ? Math.round(value) : value.toFixed(value >= 1 ? 1 : 2)}×`;
    case "days":
      return value >= 365 ? `${(value / 365).toFixed(1)} yrs` : `${value} days`;
    case "rate":
      return value.toFixed(1);
    default:
      return formatCompact(value);
  }
}

/** Key stats summarized as "you vs the average competitor". */
const HEADLINE: StatKey[] = ["subscribers", "medianShortViews", "medianLongViews", "viewsPerSub", "avgEngagement", "uploadsPerWeek"];

export default async function ComparePage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requireApprovedUser();
  const params = await searchParams;
  const services = getServices();
  const preferences = await services.onboarding.getPreferences(user.id);

  const submitted = params.you !== undefined || params.c !== undefined;
  const youInput = submitted ? String(params.you ?? "") : (preferences?.channel ?? "");
  const competitorInputs = submitted
    ? (Array.isArray(params.c) ? params.c : params.c ? [params.c] : []).map(String)
    : (preferences?.competitors ?? []);
  const slots = [...competitorInputs.filter(Boolean), ...Array(MAX_COMPETITORS_COMPARED).fill("")].slice(0, MAX_COMPETITORS_COMPARED);

  const hasInput = Boolean(youInput.trim()) || competitorInputs.some((c) => c.trim());
  let limited = false;
  if (hasInput && submitted) {
    try {
      await services.rateLimits.enforce("compareUser", user.id);
    } catch (error) {
      if (!(isAppError(error) && error.code === "RATE_LIMITED")) throw error;
      limited = true;
    }
  }
  const result = hasInput && !limited ? await asUser(user.id, "page:compare", () => services.compare.compare(youInput || null, competitorInputs)) : null;
  const columns: (ComparedChannel & { isYou: boolean })[] = result
    ? [...(result.you ? [{ ...result.you, isYou: true }] : []), ...result.competitors.map((c) => ({ ...c, isYou: false }))]
    : [];
  const competitorStats: ChannelStats[] = result?.competitors.map((c) => c.stats) ?? [];

  return (
    <div className="stack">
      <PageHeader icon={UsersIcon} title="You vs Competitors" subtitle="Compare your channel with up to 5 others using public YouTube stats." />

      <form method="get" action="/compare" className="card compare-form">
        <label className="field compare-you">
          <span>Your channel</span>
          <input name="you" defaultValue={youInput} placeholder="@yourchannel or channel link" maxLength={300} />
        </label>
        <div className="compare-competitors">
          {slots.map((value, i) => (
            <label key={i} className="field">
              <span>Competitor {i + 1}</span>
              <input name="c" defaultValue={value} placeholder="@handle or link" maxLength={300} />
            </label>
          ))}
        </div>
        <div className="compare-form-actions">
          <span className="stat-note">
            Defaults come from your <Link href="/settings/preferences">preferences</Link>. New channels take a few seconds to load the first time.
          </span>
          <button type="submit">Compare</button>
        </div>
      </form>

      {result?.failures.length ? (
        <div className="card compare-failures" role="status">
          {result.failures.map((f) => (
            <div key={f.identifier}>
              <strong>{f.identifier}</strong>: {f.error}
            </div>
          ))}
        </div>
      ) : null}

      {limited ? <div className="card empty">You&apos;ve run a lot of comparisons this hour. Try again in a bit.</div> : null}

      {!hasInput ? (
        <div className="card empty">Add your channel and a few competitors above to see how you stack up.</div>
      ) : columns.length === 0 ? null : (
        <>
          {result?.you && competitorStats.length > 0 ? (
            <section className="compare-headline">
              {HEADLINE.map((key) => {
                const row = STAT_ROWS.find((r) => r.key === key)!;
                const mine = result.you!.stats[key];
                const avg = competitorAverage(competitorStats, key);
                if (mine === null || avg === null) return null;
                const diff = avg === 0 ? null : (mine - avg) / Math.abs(avg);
                const direction = diff === null || Math.abs(diff) < 0.05 ? "flat" : diff > 0 ? "up" : "down";
                return (
                  <div key={key} className="card compare-stat" data-direction={direction}>
                    <span className="stat-note">{row.label}</span>
                    <strong>{formatStat(mine, row.kind)}</strong>
                    <span className="compare-diff">
                      {diff === null ? "—" : `${diff > 0 ? "+" : ""}${Math.round(diff * 100)}%`} vs avg competitor ({formatStat(avg, row.kind)})
                    </span>
                  </div>
                );
              })}
            </section>
          ) : null}

          <section className="card">
            <div className="table-wrap">
              <table className="compare-table">
                <thead>
                  <tr>
                    <th scope="col">Stat</th>
                    {columns.map((col) => (
                      <th key={col.channel.id} scope="col" className={col.isYou ? "is-you" : undefined}>
                        <a href={`https://www.youtube.com/channel/${col.channel.youtube_channel_id}`} target="_blank" rel="noreferrer" className="compare-channel">
                          {col.channel.thumbnail_url ? <img className="avatar" src={col.channel.thumbnail_url} alt="" loading="lazy" /> : <span className="avatar" />}
                          <span className="compare-channel-name">{col.channel.title}</span>
                          {col.isYou ? <span className="niche-badge">You</span> : null}
                        </a>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {STAT_ROWS.map((row) => {
                    const values = columns.map((col) => col.stats[row.key]);
                    const best = columns.length > 1 ? bestIndex(values, row.higherIsBetter) : null;
                    return (
                      <tr key={row.key}>
                        <th scope="row" title={row.hint}>
                          {row.label}
                        </th>
                        {values.map((value, i) => (
                          <td key={columns[i]!.channel.id} className={`${columns[i]!.isYou ? "is-you" : ""} ${best === i ? "is-best" : ""}`}>
                            {formatStat(value, row.kind)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="stat-note" style={{ marginBottom: 0 }}>
              Highlighted = best in row. Stats use each channel&apos;s last 30 Shorts and long-form uploads. Subscriber growth fills in after a
              few days of daily tracking.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
