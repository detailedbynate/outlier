/* eslint-disable @next/next/no-img-element -- YouTube images are already CDN-optimized */
import Link from "next/link";
import type { ComponentType, CSSProperties, ReactNode } from "react";
import {
  BellIcon,
  CalendarIcon,
  ChartIcon,
  CheckIcon,
  ClockIcon,
  CompassIcon,
  EyeIcon,
  FilmIcon,
  FlameIcon,
  PenIcon,
  PlayCircleIcon,
  TargetIcon,
  TrendingDownIcon,
  TrendingIcon,
  UsersIcon,
  ZapIcon,
} from "@/components/icons";
import {
  ALERT_KINDS,
  ALERT_LABEL,
  SORT_OPTIONS,
  sortProfiles,
  type AlertKind,
  type ComparisonRow,
  type Opportunity,
  type PatternStat,
  type SortKey,
} from "@/lib/competitors/intel";
import { formatCompact, formatPercent, timeAgo } from "@/lib/format";
import type { CompetitorWorkspace } from "@/lib/services/competitor-service";
import { saveCompetitorAlerts } from "./actions";
import { Avatar, ChannelCell, Delta, Multiplier, TrendBadge, VideoTable } from "./intel-ui";

export const TABS = [
  { key: "overview", label: "Overview" },
  { key: "growth", label: "Growth" },
  { key: "content", label: "Content" },
  { key: "insights", label: "Insights" },
  { key: "alerts", label: "Alerts" },
] as const;
export type TabKey = (typeof TABS)[number]["key"];
export type Href = (o: { view?: TabKey; sort?: SortKey }) => string;

type IconType = ComponentType<{ size?: number }>;

function Card({ icon: Icon, title, subtitle, action, children }: { icon?: IconType; title: string; subtitle?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="intel-card" aria-label={title}>
      <header className="intel-card-head">
        <div className="cx-card-titles">
          {Icon ? (
            <span className="cx-head-icon" aria-hidden>
              <Icon size={15} />
            </span>
          ) : null}
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/** The first few items, with the rest folded away so a tab doesn't open as a wall. */
function ShowMore<T>({ items, first, noun, render }: { items: T[]; first: number; noun: string; render: (items: T[]) => ReactNode }) {
  if (items.length <= first) return <>{render(items)}</>;
  return (
    <>
      {render(items.slice(0, first))}
      <details className="intel-more">
        <summary>
          Show {items.length - first} more {noun}
        </summary>
        {render(items.slice(first))}
      </details>
    </>
  );
}

function formatRowValue(value: number | null, kind: ComparisonRow["kind"]): string {
  if (value === null) return "—";
  if (kind === "percent") return formatPercent(value, value < 0.1 ? 2 : 1);
  if (kind === "rate") return value.toFixed(1);
  return formatCompact(value);
}

/** Bar width in percent, never so thin a real value disappears. */
const barWidth = (value: number | null, max: number) => (value === null || value <= 0 || max <= 0 ? 0 : Math.max(3, Math.min(100, (value / max) * 100)));

const videoHref = (v: { format: string; youtube_video_id: string }) =>
  v.format === "short" ? `https://www.youtube.com/shorts/${v.youtube_video_id}` : `https://www.youtube.com/watch?v=${v.youtube_video_id}`;

/** The sorts worth a chip; the rest would crowd the header. */
const QUICK_SORTS: SortKey[] = ["growth", "avg_views", "subscribers"];

/** Your channel first, then competitors, so every table shows where you stand. */
function withYou(ws: CompetitorWorkspace) {
  return [...(ws.you ? [{ p: ws.you, isYou: true }] : []), ...ws.competitors.map((p) => ({ p, isYou: false }))];
}

const profileHref = (youtubeId: string) => `/compare/${youtubeId}`;

const OPPORTUNITY: Record<Opportunity["kind"], { label: string; icon: IconType }> = {
  topic_gap: { label: "Topic gap", icon: TargetIcon },
  low_competition: { label: "Low competition", icon: CompassIcon },
  format: { label: "Format", icon: FilmIcon },
  frequency: { label: "Posting rhythm", icon: CalendarIcon },
};

/** The topic an opportunity is about, when it names one. */
function opportunityTerm(o: Opportunity): string | null {
  if (o.kind !== "topic_gap" && o.kind !== "low_competition") return null;
  return o.title.match(/“([^”]+)”/)?.[1] ?? null;
}

/** "Topic gap: “X”" reads as just X under its kind label. */
const opportunityHeadline = (o: Opportunity) => opportunityTerm(o) ?? o.title;

/** Numbers in a sentence stand out, so a detail line scans at a glance. */
function withNumbers(text: string): ReactNode {
  return text.split(/(\d[\d.,]*[KMB]?×?%?)/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));
}

/* ---------------------------------------------------------------------------
   At a glance
--------------------------------------------------------------------------- */

/** Four quick answers before any tables. */
export function Glance({ ws, href }: { ws: CompetitorWorkspace; href: Href }) {
  // Only name a fastest grower once there is enough snapshot history to judge.
  const fastest = sortProfiles(ws.competitors, "growth").find((p) => p.growth.trend.label !== "insufficient");
  const topBreakout = ws.breakouts[0];
  const topOpportunity = ws.opportunities[0];
  const week = ws.competitors
    .map((p) => ({ p, n: p.videos.filter((v) => v.ageHours <= 7 * 24).length }))
    .sort((a, b) => b.n - a.n);
  const uploadsThisWeek = week.reduce((n, w) => n + w.n, 0);
  const maxWeek = Math.max(1, ...week.map((w) => w.n));
  const OppIcon = topOpportunity ? OPPORTUNITY[topOpportunity.kind].icon : TargetIcon;

  return (
    <div className="cx-glance">
      <Link href={href({ view: "growth" })} className="cx-glance-card" scroll={false}>
        <span className="cx-glance-label">
          <span className="cx-glance-icon">
            <TrendingIcon size={14} />
          </span>
          Fastest growing
        </span>
        {fastest ? (
          <>
            <span className="cx-glance-channel">
              <Avatar channel={fastest.channel} size={34} />
              <strong>{fastest.channel.title}</strong>
            </span>
            <span className="cx-glance-foot">
              <TrendBadge label={fastest.growth.trend.label} />
              {fastest.growth.d7.views !== null ? (
                <span>
                  <Delta value={fastest.growth.d7.views} /> views this week
                </span>
              ) : null}
            </span>
          </>
        ) : (
          <>
            <strong className="cx-glance-value">Collecting data</strong>
            <span className="cx-glance-foot">Trends need about a week of history</span>
          </>
        )}
      </Link>

      <Link href={href({ view: "content" })} className="cx-glance-card" scroll={false}>
        <span className="cx-glance-label">
          <span className="cx-glance-icon" data-tone="hot">
            <FlameIcon size={14} />
          </span>
          Top breakout
        </span>
        {topBreakout ? (
          <span className="cx-glance-video">
            <span className="cx-glance-thumb" data-format={topBreakout.format}>
              <img src={`https://i.ytimg.com/vi/${topBreakout.youtube_video_id}/hqdefault.jpg`} alt="" loading="lazy" />
            </span>
            <span className="cx-glance-video-text">
              <Multiplier value={topBreakout.multiplier} />
              <span className="cx-glance-title">{topBreakout.title}</span>
              <span className="cx-glance-sub">
                {topBreakout.channel.title} · {formatCompact(topBreakout.view_count)} views
              </span>
            </span>
          </span>
        ) : (
          <>
            <strong className="cx-glance-value">None yet</strong>
            <span className="cx-glance-foot">Nothing at 2× or more in 14 days</span>
          </>
        )}
      </Link>

      <Link href={href({ view: "insights" })} className="cx-glance-card" scroll={false}>
        <span className="cx-glance-label">
          <span className="cx-glance-icon">
            <OppIcon size={14} />
          </span>
          Top opportunity
        </span>
        {topOpportunity ? (
          <>
            <strong className="cx-glance-value cx-glance-clamp">{opportunityHeadline(topOpportunity)}</strong>
            <span className="cx-glance-foot">
              <span className="cx-tag">{OPPORTUNITY[topOpportunity.kind].label}</span>
              {ws.opportunities.length > 1 ? <span>+{ws.opportunities.length - 1} more</span> : null}
            </span>
          </>
        ) : (
          <>
            <strong className="cx-glance-value">None yet</strong>
            <span className="cx-glance-foot">{ws.you ? "No clear gaps right now" : "Add your channel to find gaps"}</span>
          </>
        )}
      </Link>

      <Link href={href({ view: "content" })} className="cx-glance-card" scroll={false}>
        <span className="cx-glance-label">
          <span className="cx-glance-icon">
            <PlayCircleIcon size={14} />
          </span>
          Uploads this week
        </span>
        <strong className="cx-glance-value cx-glance-num">{uploadsThisWeek}</strong>
        <span className="cx-glance-split">
          {week.slice(0, 3).map(({ p, n }) => (
            <span key={p.channel.id} className="cx-glance-split-row">
              <span className="cx-glance-split-name">{p.channel.title}</span>
              <span className="cx-track">
                <span className="cx-fill" style={{ width: `${barWidth(n, maxWeek)}%` }} />
              </span>
              <span className="cx-glance-split-n">{n}</span>
            </span>
          ))}
        </span>
      </Link>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Overview
--------------------------------------------------------------------------- */

export function OverviewTab({ ws, sort, href }: { ws: CompetitorWorkspace; sort: SortKey; href: Href }) {
  const rows = withYou(ws);
  const maxAvg = Math.max(0, ...rows.map(({ p }) => p.avgViews ?? 0));
  const maxRecent = Math.max(0, ...rows.map(({ p }) => p.recentViews ?? 0));
  return (
    <>
      <Card
        icon={UsersIcon}
        title="Channels"
        subtitle="Tap a channel for its full profile"
        action={
          <div className="intel-card-actions">
            <label className="intel-more-toggle intel-chip">
              <input type="checkbox" />
              <span>More stats</span>
            </label>
            <label className="intel-sort">
              <span className="intel-muted">Sort</span>
              <span className="intel-sort-links">
                {SORT_OPTIONS.filter((o) => QUICK_SORTS.includes(o.key) || o.key === sort).map((o) => (
                  <Link key={o.key} href={href({ sort: o.key })} className="intel-chip" aria-current={o.key === sort} scroll={false}>
                    {o.label}
                  </Link>
                ))}
              </span>
            </label>
          </div>
        }
      >
        <div className="table-wrap">
          <table className="intel-table card-table">
            <thead>
              <tr>
                <th>Channel</th>
                <th>Trend</th>
                <th className="num">Subs 7d</th>
                <th className="num">Avg views</th>
                <th className="num intel-extra">Views 7d</th>
                <th className="num intel-extra">Uploads/wk</th>
                <th className="num intel-extra">Outlier rate</th>
                <th className="num">Best recent</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, isYou }) => (
                <tr key={p.channel.id} data-you={isYou}>
                  <td className="card-table-title">
                    <ChannelCell channel={p.channel} href={profileHref(p.channel.youtube_channel_id)} />
                    {isYou ? <span className="niche-badge">You</span> : null}
                  </td>
                  <td data-label="Trend">
                    <TrendBadge label={p.growth.trend.label} />
                  </td>
                  <td className="num" data-label="Subs 7d">
                    <Delta value={p.growth.d7.subs} />
                  </td>
                  <td className="num" data-label="Avg views">
                    <span className="cx-cell-bar">
                      {formatCompact(p.avgViews)}
                      <span className="cx-track">
                        <span className="cx-fill" style={{ width: `${barWidth(p.avgViews, maxAvg)}%` }} />
                      </span>
                    </span>
                  </td>
                  <td className="num intel-extra" data-label="Views 7d">
                    <span className="cx-cell-bar">
                      {formatCompact(p.recentViews)}
                      <span className="cx-track">
                        <span className="cx-fill" style={{ width: `${barWidth(p.recentViews, maxRecent)}%` }} />
                      </span>
                    </span>
                  </td>
                  <td className="num intel-extra" data-label="Uploads/wk">{p.uploadsPerWeek.toFixed(1)}</td>
                  <td className="num intel-extra" data-label="Outlier rate">{formatPercent(p.outlierRate, 0)}</td>
                  <td className="num" data-label="Best recent">
                    {p.bestRecent ? (
                      <a href={`https://www.youtube.com/watch?v=${p.bestRecent.youtube_video_id}`} target="_blank" rel="noreferrer" title={p.bestRecent.title}>
                        <Multiplier value={p.bestRecent.multiplier} />
                      </a>
                    ) : (
                      <span className="intel-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card icon={ChartIcon} title="Head to head" subtitle={ws.you ? `You against each of your ${ws.competitors.length} competitors, metric by metric` : undefined}>
        {!ws.you || !ws.comparison ? (
          <p className="intel-muted">Add your channel in Edit channels to see how you compare.</p>
        ) : (
          <>
            {ws.comparison.insights.length > 0 ? (
              <ul className="cx-insights">
                {ws.comparison.insights.map((s) => {
                  const up = /\b(higher|more)\b/.test(s);
                  return (
                    <li key={s} data-tone={up ? "up" : "down"}>
                      <span className="cx-insight-icon" aria-hidden>
                        {up ? <TrendingIcon size={14} /> : <TrendingDownIcon size={14} />}
                      </span>
                      <span>{withNumbers(s)}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="intel-muted">Not enough shared data yet to draw clear differences.</p>
            )}
            <HeadToHead ws={ws} />
          </>
        )}
      </Card>
    </>
  );
}

/** One card per metric: your number, how it compares, and a bar for every channel. */
function HeadToHead({ ws }: { ws: CompetitorWorkspace }) {
  const you = ws.you!;
  const channels = new Map(ws.competitors.map((c) => [c.channel.id, c.channel]));
  const rows = ws.comparison!.rows.filter((r) => r.you !== null || r.perCompetitor.some((c) => c.value !== null));
  return (
    <div className="cx-h2h">
      {rows.map((row) => {
        const entries = [
          { id: you.channel.id, name: "You", value: row.you, isYou: true },
          ...row.perCompetitor.map((c) => ({ id: c.channelId, name: channels.get(c.channelId)?.title ?? "Competitor", value: c.value, isYou: false })),
        ];
        const max = Math.max(0, ...entries.map((e) => e.value ?? 0));
        const ranked = entries.filter((e) => e.value !== null).sort((a, b) => b.value! - a.value!);
        const rank = row.you === null ? null : ranked.findIndex((e) => e.isYou) + 1;
        const dir = row.diff === null ? "none" : row.diff >= 0.05 ? "up" : row.diff <= -0.05 ? "down" : "flat";
        // Rates differ in percentage points, counts in percent; a gap that rounds to nothing reads "level".
        const points = row.you !== null && row.competitorAvg !== null ? Math.abs(row.you - row.competitorAvg) * 100 : 0;
        const pct = row.diff === null ? 0 : Math.round(Math.abs(row.diff) * 100);
        const ahead = row.diff !== null && row.diff >= 0;
        const gap =
          row.diff === null || row.you === null || row.competitorAvg === null
            ? null
            : row.kind === "percent"
              ? points < 0.05
                ? "level"
                : `${ahead ? "+" : "−"}${points.toFixed(1)} pts`
              : pct === 0
                ? "level"
                : `${ahead ? "+" : "−"}${pct}%`;
        return (
          <article key={row.key} className="cx-h2h-card" data-dir={dir}>
            <header>
              <span className="cx-h2h-label">{row.label}</span>
              {rank ? (
                <span className="cx-rank" data-first={rank === 1}>
                  #{rank}
                  <small> of {ranked.length}</small>
                </span>
              ) : null}
            </header>
            <div className="cx-h2h-value">
              <strong>{formatRowValue(row.you, row.kind)}</strong>
              {gap ? (
                <span className="cx-gap" data-dir={dir}>
                  {gap}
                </span>
              ) : null}
              <span className="cx-h2h-avg">avg {formatRowValue(row.competitorAvg, row.kind)}</span>
            </div>
            <ul className="cx-h2h-bars">
              {entries.map((e) => (
                <li key={e.id} data-you={e.isYou}>
                  <span className="cx-h2h-name">{e.name}</span>
                  <span className="cx-track">
                    <span className="cx-fill" style={{ width: `${barWidth(e.value, max)}%` }} />
                  </span>
                  <span className="cx-h2h-num">{formatRowValue(e.value, row.kind)}</span>
                </li>
              ))}
            </ul>
          </article>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Growth
--------------------------------------------------------------------------- */

export function GrowthTab({ ws }: { ws: CompetitorWorkspace }) {
  const rows = withYou(ws).sort((a, b) => (b.p.growth.d7.views ?? -1) - (a.p.growth.d7.views ?? -1));
  const maxViews = Math.max(0, ...rows.map(({ p }) => p.growth.d7.views ?? 0));
  const maxSubs = Math.max(0, ...rows.map(({ p }) => p.growth.d7.subsPct ?? 0));
  return (
    <Card icon={TrendingIcon} title="Growth race" subtitle="This week, from saved snapshots, ranked by views gained. Trend compares the last 3 days of views with the 4 days before.">
      <ol className="cx-race">
        {rows.map(({ p, isYou }, i) => {
          const { trend, d7, d30 } = p.growth;
          return (
            <li key={p.channel.id} data-you={isYou} data-lead={i === 0 && (d7.views ?? 0) > 0}>
              <span className="cx-race-rank">{i + 1}</span>
              <span className="cx-race-channel">
                <ChannelCell channel={p.channel} href={profileHref(p.channel.youtube_channel_id)} />
                {isYou ? <span className="niche-badge">You</span> : null}
              </span>
              <span className="cx-race-trend">
                <TrendBadge
                  label={trend.label}
                  title={trend.recentDailyViews !== null ? `${formatCompact(trend.recentDailyViews)} views/day, was ${formatCompact(trend.priorDailyViews)}` : undefined}
                />
              </span>
              <span className="cx-race-metric">
                <span className="cx-race-head">
                  <span>Views 7d</span>
                  <Delta value={d7.views} />
                </span>
                <span className="cx-track">
                  <span className="cx-fill" style={{ width: `${barWidth(d7.views, maxViews)}%` }} />
                </span>
              </span>
              <span className="cx-race-metric">
                <span className="cx-race-head">
                  <span>Subs 7d</span>
                  <Delta value={d7.subs} pct={d7.subsPct} />
                </span>
                <span className="cx-track">
                  <span className="cx-fill" data-kind="subs" style={{ width: `${barWidth(d7.subsPct, maxSubs)}%` }} />
                </span>
              </span>
              <span className="cx-race-stat">
                <span>Views/day</span>
                <strong>{trend.recentDailyViews !== null ? formatCompact(trend.recentDailyViews) : "—"}</strong>
                <small>{trend.priorDailyViews !== null ? `was ${formatCompact(trend.priorDailyViews)}` : d30 ? <>30d <Delta value={d30.subs} suffix=" subs" /></> : "Collecting"}</small>
              </span>
            </li>
          );
        })}
      </ol>
      {ws.competitors.every((p) => p.growth.trend.label === "insufficient") ? (
        <p className="intel-muted">Growth trends appear after about a week of daily snapshots.</p>
      ) : null}
    </Card>
  );
}

/* ---------------------------------------------------------------------------
   Content
--------------------------------------------------------------------------- */

type Breakout = CompetitorWorkspace["breakouts"][number] | (CompetitorWorkspace["latestUploads"][number] & { score?: number });

function BreakoutGrid({ items, youId, format }: { items: Breakout[]; youId: string | undefined; format: "short" | "long" }) {
  return (
    <ul className="cx-breaks" data-format={format}>
      {items.map((v) => {
        const mine = v.channel.id === youId;
        return (
          <li key={v.id}>
            <a href={videoHref(v)} target="_blank" rel="noreferrer" className="cx-break" data-you={mine}>
              <span className="cx-break-thumb">
                <img src={`https://i.ytimg.com/vi/${v.youtube_video_id}/hqdefault.jpg`} alt="" loading="lazy" />
                <span className="cx-break-mult">
                  <Multiplier value={v.multiplier} />
                </span>
                <span className="cx-break-views">
                  <EyeIcon size={12} />
                  {formatCompact(v.view_count)}
                </span>
              </span>
              <span className="cx-break-body">
                <span className="cx-break-title">{v.title}</span>
                <span className="cx-break-channel">
                  <Avatar channel={v.channel} size={18} />
                  <span>{mine ? "You" : v.channel.title}</span>
                </span>
                <span className="cx-break-meta">
                  <span>
                    <ZapIcon size={11} />
                    {formatCompact(Math.round(v.vph))}/hr
                  </span>
                  <span>
                    <ClockIcon size={11} />
                    {timeAgo(v.published_at)}
                  </span>
                </span>
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function ContentTab({ ws }: { ws: CompetitorWorkspace }) {
  // Your own uploads sit alongside theirs, marked, so you can see how yours land.
  const mine = ws.you ? ws.you.videos.map((v) => ({ ...v, channel: ws.you!.channel })) : [];
  const breakouts: Breakout[] = [...ws.breakouts, ...mine.filter((v) => (v.multiplier ?? 0) >= 2 && v.ageHours <= 14 * 24)].sort((a, b) => (b.multiplier ?? 0) - (a.multiplier ?? 0));
  const shorts = breakouts.filter((v) => v.format === "short");
  const longs = breakouts.filter((v) => v.format !== "short");
  const uploads = [...ws.latestUploads, ...mine.slice(0, 10)].sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  const youId = ws.you?.channel.id;
  return (
    <>
      <Card icon={FlameIcon} title="Breakouts right now" subtitle="Last 14 days, beating their channel's normal views">
        {breakouts.length === 0 ? (
          <p className="intel-muted">No breakouts in the last 14 days.</p>
        ) : (
          <div className="cx-break-groups">
            {shorts.length > 0 ? (
              <div>
                {longs.length > 0 ? <h3 className="dash-subhead">Shorts</h3> : null}
                <ShowMore items={shorts} first={10} noun="Shorts" render={(items) => <BreakoutGrid items={items} youId={youId} format="short" />} />
              </div>
            ) : null}
            {longs.length > 0 ? (
              <div>
                {shorts.length > 0 ? <h3 className="dash-subhead">Long-form</h3> : null}
                <ShowMore items={longs} first={6} noun="videos" render={(items) => <BreakoutGrid items={items} youId={youId} format="long" />} />
              </div>
            ) : null}
          </div>
        )}
      </Card>
      <Card icon={PlayCircleIcon} title="Latest uploads" subtitle="Highlighted rows are 3× or more their channel's normal views">
        <ShowMore items={uploads} first={8} noun="uploads" render={(items) => <VideoTable videos={items} showChannel compact />} />
      </Card>
    </>
  );
}

/* ---------------------------------------------------------------------------
   Insights
--------------------------------------------------------------------------- */

export function InsightsTab({ ws }: { ws: CompetitorWorkspace }) {
  const w = ws.working;
  return (
    <>
      <Card icon={TargetIcon} title="Opportunities" subtitle="Gaps backed by your competitors' results, best bet first">
        {ws.opportunities.length === 0 ? (
          <p className="intel-muted">{ws.you ? "No clear gaps yet. These appear when competitors get strong, repeated results you're not matching." : "Add your channel to find topic, format, and posting gaps."}</p>
        ) : (
          <ul className="cx-opps">
            {ws.opportunities.map((o, i) => {
              const kind = OPPORTUNITY[o.kind];
              const term = opportunityTerm(o);
              return (
                <li key={o.title} className="cx-opp" data-top={i === 0}>
                  <header>
                    <span className="cx-opp-icon" aria-hidden>
                      <kind.icon size={16} />
                    </span>
                    <span className="cx-tag">{kind.label}</span>
                    {i === 0 ? <span className="cx-opp-best">Best bet</span> : null}
                  </header>
                  <strong className="cx-opp-title">{opportunityHeadline(o)}</strong>
                  <p>{withNumbers(o.detail)}</p>
                  {term ? (
                    <Link href={`/research/scriptwriter?idea=${encodeURIComponent(term)}`} className="cx-opp-action">
                      <PenIcon size={13} />
                      Write a script about it
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card icon={ZapIcon} title="What's working" subtitle={`${w.sampleVideos} competitor uploads from the last 60 days · lift compares each pattern with their uploads overall`}>
        {w.sampleVideos < 3 ? (
          <p className="intel-muted">Patterns appear once competitors have a few saved uploads.</p>
        ) : (
          <>
            <dl className="cx-facts">
              <div>
                <dt>
                  <CalendarIcon size={13} />
                  Uploads a week
                </dt>
                <dd>{w.medianUploadsPerWeek?.toFixed(1) ?? "—"}</dd>
                <span>median channel</span>
              </div>
              <div>
                <dt>
                  <FilmIcon size={13} />
                  Short length
                </dt>
                <dd>{w.medianShortSeconds !== null ? `${w.medianShortSeconds}s` : "—"}</dd>
                <span>median Short</span>
              </div>
              <div>
                <dt>
                  <PlayCircleIcon size={13} />
                  Long-form length
                </dt>
                <dd>{w.medianLongMinutes !== null ? `${w.medianLongMinutes} min` : "—"}</dd>
                <span>median video</span>
              </div>
              <div>
                <dt>
                  <ClockIcon size={13} />
                  Best day to post
                </dt>
                <dd>{w.bestWeekday ? w.bestWeekday.label : "—"}</dd>
                <span>{w.bestWeekday?.lift ? `${w.bestWeekday.lift.toFixed(2)}× lift · UTC` : "UTC"}</span>
              </div>
            </dl>
            <div className="cx-working">
              <PatternList title="Topics" items={w.topics} />
              <PatternList title="Formats" items={w.formats} />
              <PatternList title="Title patterns" items={w.titles} />
            </div>
          </>
        )}
      </Card>
    </>
  );
}

export function PatternList({ title, items, limit = 4 }: { title: string; items: PatternStat[]; limit?: number }) {
  const shown = items.slice(0, limit);
  const scale = Math.max(2, ...shown.map((p) => p.lift ?? 0));
  return (
    <div className="cx-patterns">
      <h3 className="dash-subhead">{title}</h3>
      {shown.length === 0 ? (
        <p className="intel-muted">Not enough data</p>
      ) : (
        <ul>
          {shown.map((p) => {
            const dir = p.lift === null ? "none" : p.lift >= 1.1 ? "up" : p.lift <= 0.9 ? "down" : "flat";
            return (
              <li key={p.label}>
                <span className="cx-pattern-top">
                  <span className="cx-pattern-label">{p.label}</span>
                  <span className="cx-lift" data-dir={dir}>
                    {p.lift === null ? "—" : `${p.lift.toFixed(2)}×`}
                  </span>
                </span>
                <span className="cx-lift-track" style={{ "--base": `${(1 / scale) * 100}%` } as CSSProperties}>
                  <span className="cx-lift-fill" data-dir={dir} style={{ width: `${barWidth(p.lift, scale)}%` }} />
                </span>
                <span className="cx-pattern-sub">
                  {p.videos} videos · {formatCompact(p.avgViews)} avg
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Alerts
--------------------------------------------------------------------------- */

const ALERT_ICON: Record<AlertKind, { icon: IconType; tone: string; short: string }> = {
  uploads: { icon: PlayCircleIcon, tone: "info", short: "Upload" },
  breakouts: { icon: FlameIcon, tone: "hot", short: "Breakout" },
  subscriber_growth: { icon: UsersIcon, tone: "up", short: "Subscribers" },
  view_growth: { icon: TrendingIcon, tone: "up", short: "Views" },
};

const HOUR = 3_600_000;

/** Alerts by how long ago they happened, newest group first. */
function groupAlerts(alerts: CompetitorWorkspace["alerts"], now = Date.now()) {
  const age = (at: string) => now - Date.parse(at);
  return [
    { label: "Last 24 hours", items: alerts.filter((a) => age(a.at) < 24 * HOUR) },
    { label: "1–3 days ago", items: alerts.filter((a) => age(a.at) >= 24 * HOUR && age(a.at) < 72 * HOUR) },
    { label: "Earlier this week", items: alerts.filter((a) => age(a.at) >= 72 * HOUR) },
  ].filter((g) => g.items.length > 0);
}

export function AlertsTab({ ws }: { ws: CompetitorWorkspace }) {
  const formats = new Map([...(ws.you ? [ws.you] : []), ...ws.competitors].flatMap((p) => p.videos.map((v) => [v.youtube_video_id, v.format] as const)));
  const groups = groupAlerts(ws.alerts);

  return (
    <Card icon={BellIcon} title="Alerts" subtitle="Last 7 days, from scheduled refreshes">
      <form action={saveCompetitorAlerts} className="cx-alert-settings">
        <span className="cx-alert-settings-label">Alert me about</span>
        {ALERT_KINDS.map((kind) => (
          <label key={kind} className="cx-toggle">
            <input type="checkbox" name="alerts" value={kind} defaultChecked={ws.enabledAlerts.includes(kind)} />
            <span>
              <CheckIcon size={12} />
              {ALERT_LABEL[kind]}
            </span>
          </label>
        ))}
        <button type="submit" className="button-ghost button-small">
          Save
        </button>
      </form>
      {groups.length === 0 ? (
        <p className="intel-muted">No alerts in the last 7 days.</p>
      ) : (
        groups.map((g) => (
          <div key={g.label} className="cx-alert-group">
            <h3 className="dash-subhead">{g.label}</h3>
            <ul className="cx-alerts">
              {g.items.map((a, i) => {
                const kind = ALERT_ICON[a.kind];
                const upload = a.kind === "uploads";
                const format = a.youtubeVideoId ? (formats.get(a.youtubeVideoId) ?? "long_form") : null;
                const body = (
                  <>
                    <span className="cx-alert-media" data-format={format ?? "channel"}>
                      {a.youtubeVideoId ? <img src={`https://i.ytimg.com/vi/${a.youtubeVideoId}/hqdefault.jpg`} alt="" loading="lazy" /> : <Avatar channel={a.channel} size={44} />}
                    </span>
                    <span className="cx-alert-text">
                      <strong>{upload ? a.detail : a.title}</strong>
                      <span>{[upload ? `${a.channel.title} uploaded` : a.detail, timeAgo(a.at)].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="cx-alert-kind" data-tone={kind.tone}>
                      <kind.icon size={12} />
                      {kind.short}
                    </span>
                  </>
                );
                return (
                  <li key={`${a.kind}-${a.channel.id}-${i}`}>
                    {a.youtubeVideoId ? (
                      <a className="cx-alert" href={videoHref({ format: format!, youtube_video_id: a.youtubeVideoId })} target="_blank" rel="noreferrer">
                        {body}
                      </a>
                    ) : (
                      <div className="cx-alert">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </Card>
  );
}
