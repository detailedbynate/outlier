import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { UsersIcon } from "@/components/icons";
import { ALERT_KINDS, ALERT_LABEL, SORT_OPTIONS, type ComparisonRow, type PatternStat, type SortKey } from "@/lib/competitors/intel";
import { requireApprovedUser } from "@/lib/auth/session";
import { formatCompact, formatPercent, timeAgo } from "@/lib/format";
import { MAX_COMPETITORS } from "@/lib/onboarding/schema";
import { getServices } from "@/lib/services";
import type { CompetitorWorkspace } from "@/lib/services/competitor-service";
import { saveCompetitorAlerts, syncCompetitors } from "./actions";
import { ChannelCell, Delta, Diff, Multiplier, TrendBadge, VideoTable } from "./intel-ui";
import { SyncButton } from "./sync-button";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata: Metadata = { title: "Competitors · Outlier" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "growth", label: "Growth" },
  { key: "content", label: "Content" },
  { key: "insights", label: "Insights" },
  { key: "alerts", label: "Alerts" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const STATUS_TEXT: Record<string, { tone: "good" | "warn"; text: string }> = {
  synced: { tone: "good", text: "Up to date." },
  rate_limited: { tone: "warn", text: "You've refreshed a lot this hour. Showing saved data." },
  quota: { tone: "warn", text: "YouTube data is at today's limit. Showing saved data, which may be older." },
  error: { tone: "warn", text: "Couldn't refresh some channels. Showing saved data." },
};

function Card({ title, subtitle, action, children }: { title: string; subtitle?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="intel-card" aria-label={title}>
      <header className="intel-card-head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function formatRowValue(value: number | null, kind: ComparisonRow["kind"]): string {
  if (value === null) return "—";
  if (kind === "percent") return formatPercent(value, value < 0.1 ? 2 : 1);
  if (kind === "rate") return value.toFixed(1);
  return formatCompact(value);
}

export default async function CompetitorsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requireApprovedUser();
  const params = await searchParams;
  const services = getServices();
  const preferences = await services.onboarding.getPreferences(user.id);

  const fromUrl = params.you !== undefined || params.c !== undefined;
  const you = (fromUrl ? String(params.you ?? "") : (preferences?.channel ?? "")).trim();
  const competitorInputs = (fromUrl ? (Array.isArray(params.c) ? params.c : params.c ? [params.c] : []).map(String) : (preferences?.competitors ?? []))
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, MAX_COMPETITORS);
  const sort = (SORT_OPTIONS.find((o) => o.key === params.sort)?.key ?? "growth") as SortKey;
  const tab = (TABS.find((t) => t.key === params.view)?.key ?? "overview") as TabKey;
  const status = typeof params.status === "string" ? (params.status.startsWith("failed") ? "error" : params.status) : null;

  const hasChannels = competitorInputs.length > 0;
  const ws = hasChannels ? await services.competitors.workspace({ you: you || null, competitors: competitorInputs, userId: user.id, sort }) : null;

  const href = (overrides: { view?: TabKey; sort?: SortKey }) => {
    const q = new URLSearchParams();
    if (fromUrl) {
      if (you) q.set("you", you);
      for (const c of competitorInputs) q.append("c", c);
    }
    const nextSort = overrides.sort ?? sort;
    if (nextSort !== "growth") q.set("sort", nextSort);
    const nextView = overrides.view ?? tab;
    if (nextView !== "overview") q.set("view", nextView);
    const qs = q.toString();
    return `/compare${qs ? `?${qs}` : ""}`;
  };

  const slots = [...competitorInputs, ...Array(MAX_COMPETITORS).fill("")].slice(0, Math.max(5, competitorInputs.length + 1));
  const channelForm = (
    <form action={syncCompetitors} className="intel-form">
      <label className="field">
        <span>Your channel</span>
        <input name="you" defaultValue={you} placeholder="@yourchannel or channel link" maxLength={300} />
      </label>
      <div className="intel-form-competitors">
        {slots.map((value, i) => (
          <label key={i} className="field">
            <span>Competitor {i + 1}</span>
            <input name="c" defaultValue={value} placeholder="@handle or link" maxLength={300} />
          </label>
        ))}
      </div>
      <div className="intel-form-actions">
        <label className="checkbox-field">
          <input type="checkbox" name="save" defaultChecked />
          <span>Save as my competitors</span>
        </label>
        <SyncButton label={hasChannels ? "Update & refresh" : "Start tracking"} />
      </div>
    </form>
  );

  return (
    <div className="dash intel">
      <header className="intel-top">
        <div className="intel-title">
          <span className="dash-icon" data-tone="violet">
            <UsersIcon size={16} />
          </span>
          <div>
            <h1>Competitors</h1>
            <p>
              {ws
                ? `${ws.competitors.length} competitor${ws.competitors.length === 1 ? "" : "s"}${ws.you ? ` vs ${ws.you.channel.title}` : ""}`
                : "How you stack up, who's growing, and what's working"}
            </p>
          </div>
        </div>
        {hasChannels ? (
          <details className="intel-edit">
            <summary>Edit channels</summary>
            {channelForm}
          </details>
        ) : null}
      </header>

      {status && STATUS_TEXT[status] ? (
        <div className="intel-status" data-tone={STATUS_TEXT[status]!.tone} role="status">
          {STATUS_TEXT[status]!.text}
        </div>
      ) : null}

      {!hasChannels ? (
        <section className="intel-card">
          <div className="dash-empty">
            <strong>Track your competitors</strong>
            <p>Add your channel and up to {MAX_COMPETITORS} competitors. Outlier keeps them refreshed and shows growth, breakouts, what&apos;s working, and gaps you can fill.</p>
          </div>
          {channelForm}
        </section>
      ) : ws ? (
        <>
          {ws.missing.length > 0 || ws.youPending ? (
            <div className="intel-status" data-tone="warn">
              Not loaded yet: {[...(ws.youPending ? [ws.youPending] : []), ...ws.missing].join(", ")}. Open Edit channels and click Update &amp; refresh.
            </div>
          ) : null}

          {ws.competitors.length === 0 ? (
            <div className="dash-empty">
              <strong>No competitor data yet</strong>
              <p>Open Edit channels and click Update &amp; refresh to load them.</p>
            </div>
          ) : (
            <>
              <Glance ws={ws} href={href} />

              <nav className="intel-tabs" aria-label="Competitor sections">
                {TABS.map((t) => {
                  const count = t.key === "alerts" ? ws.alerts.length : t.key === "insights" ? ws.opportunities.length : t.key === "content" ? ws.breakouts.length : 0;
                  return (
                    <Link key={t.key} href={href({ view: t.key })} className="intel-tab" aria-current={t.key === tab ? "page" : undefined} scroll={false}>
                      {t.label}
                      {count > 0 ? <span className="intel-tab-count">{count}</span> : null}
                    </Link>
                  );
                })}
              </nav>

              {tab === "overview" ? <OverviewTab ws={ws} sort={sort} href={href} /> : null}
              {tab === "growth" ? <GrowthTab ws={ws} /> : null}
              {tab === "content" ? <ContentTab ws={ws} /> : null}
              {tab === "insights" ? <InsightsTab ws={ws} /> : null}
              {tab === "alerts" ? <AlertsTab ws={ws} /> : null}
            </>
          )}
        </>
      ) : null}
    </div>
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

/** The sorts worth a chip; the rest would crowd the header. */
const QUICK_SORTS: SortKey[] = ["growth", "avg_views", "subscribers"];

/** Your channel first, then competitors, so every table shows where you stand. */
function withYou(ws: CompetitorWorkspace) {
  return [...(ws.you ? [{ p: ws.you, isYou: true }] : []), ...ws.competitors.map((p) => ({ p, isYou: false }))];
}

type Href = (o: { view?: TabKey; sort?: SortKey }) => string;
const profileHref = (youtubeId: string) => `/compare/${youtubeId}`;

/** Four quick answers before any tables. */
function Glance({ ws, href }: { ws: CompetitorWorkspace; href: Href }) {
  // Only name a fastest grower once there is enough snapshot history to judge.
  const fastest = ws.competitors.find((p) => p.growth.trend.label !== "insufficient");
  const topBreakout = ws.breakouts[0];
  const topOpportunity = ws.opportunities[0];
  const uploadsThisWeek = ws.competitors.reduce((n, p) => n + p.videos.filter((v) => v.ageHours <= 7 * 24).length, 0);

  const items: { label: string; value: ReactNode; note: ReactNode; to: string }[] = [
    {
      label: "Fastest growing",
      value: fastest ? fastest.channel.title : "Collecting data",
      note: fastest ? <TrendBadge label={fastest.growth.trend.label} /> : "Trends need about a week of history",
      to: href({ view: "growth" }),
    },
    {
      label: "Top breakout",
      value: topBreakout ? <Multiplier value={topBreakout.multiplier} /> : "None yet",
      note: topBreakout ? topBreakout.title : "Last 14 days",
      to: href({ view: "content" }),
    },
    {
      label: "Top opportunity",
      value: topOpportunity ? (topOpportunity.title.includes(":") ? topOpportunity.title.replace(/^[^:]+:\s*/, "") : topOpportunity.title) : "None yet",
      note: topOpportunity ? (topOpportunity.title.includes(":") ? topOpportunity.title.split(":")[0] : topOpportunity.detail) : ws.you ? "No clear gaps" : "Add your channel",
      to: href({ view: "insights" }),
    },
    {
      label: "Uploads this week",
      value: String(uploadsThisWeek),
      note: `across ${ws.competitors.length} competitors`,
      to: href({ view: "content" }),
    },
  ];

  return (
    <div className="intel-glance">
      {items.map((item) => (
        <Link key={item.label} href={item.to} className="intel-glance-item" scroll={false}>
          <span className="intel-glance-label">{item.label}</span>
          <span className="intel-glance-value">{item.value}</span>
          <span className="intel-glance-note">{item.note}</span>
        </Link>
      ))}
    </div>
  );
}

function OverviewTab({ ws, sort, href }: { ws: CompetitorWorkspace; sort: SortKey; href: Href }) {
  const rows = withYou(ws);
  return (
    <>
      <Card
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
          <table className="intel-table">
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
                  <td>
                    <ChannelCell channel={p.channel} href={profileHref(p.channel.youtube_channel_id)} />
                    {isYou ? <span className="niche-badge">You</span> : null}
                  </td>
                  <td>
                    <TrendBadge label={p.growth.trend.label} />
                  </td>
                  <td className="num">
                    <Delta value={p.growth.d7.subs} />
                  </td>
                  <td className="num">{formatCompact(p.avgViews)}</td>
                  <td className="num intel-extra">{formatCompact(p.recentViews)}</td>
                  <td className="num intel-extra">{p.uploadsPerWeek.toFixed(1)}</td>
                  <td className="num intel-extra">{formatPercent(p.outlierRate, 0)}</td>
                  <td className="num">
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
      <Card title="You vs competitors" subtitle={ws.you ? `Compared with the average of ${ws.competitors.length} competitors` : undefined}>
        {!ws.you || !ws.comparison ? (
          <p className="intel-muted">Add your channel in Edit channels to see how you compare.</p>
        ) : (
          <>
            {ws.comparison.insights.length > 0 ? (
              <ul className="intel-insights">
                {ws.comparison.insights.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            ) : (
              <p className="intel-muted">Not enough shared data yet to draw clear differences.</p>
            )}
            <details className="intel-more">
              <summary>Full comparison</summary>
              <div className="table-wrap">
                <table className="intel-table intel-compare">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th className="num">You</th>
                      <th className="num">Avg</th>
                      <th className="num">Diff</th>
                      {ws.competitors.map((c) => (
                        <th key={c.channel.id} className="num" title={c.channel.title}>
                          {c.channel.title.length > 12 ? `${c.channel.title.slice(0, 11)}…` : c.channel.title}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ws.comparison.rows.map((row) => (
                      <tr key={row.key}>
                        <th scope="row">{row.label}</th>
                        <td className="num">
                          <strong>{formatRowValue(row.you, row.kind)}</strong>
                        </td>
                        <td className="num">{formatRowValue(row.competitorAvg, row.kind)}</td>
                        <td className="num">
                          <Diff value={row.diff} />
                        </td>
                        {row.perCompetitor.map((c) => (
                          <td key={c.channelId} className="num">
                            {formatRowValue(c.value, row.kind)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </Card>
    </>
  );
}

function GrowthTab({ ws }: { ws: CompetitorWorkspace }) {
  return (
    <Card title="Growth" subtitle="From saved snapshots. Trend compares the last 3 days of views with the 4 days before.">
      <div className="table-wrap">
        <table className="intel-table">
          <thead>
            <tr>
              <th>Channel</th>
              <th>Trend</th>
              <th className="num">Subs 7d</th>
              <th className="num">Subs 30d</th>
              <th className="num">Views 7d</th>
            </tr>
          </thead>
          <tbody>
            {withYou(ws).map(({ p, isYou }) => (
              <tr key={p.channel.id} data-you={isYou} data-highlight={p.growth.trend.label === "accelerating"}>
                <td>
                  <ChannelCell channel={p.channel} href={profileHref(p.channel.youtube_channel_id)} />
                  {isYou ? <span className="niche-badge">You</span> : null}
                </td>
                <td>
                  <TrendBadge
                    label={p.growth.trend.label}
                    title={p.growth.trend.recentDailyViews !== null ? `${formatCompact(p.growth.trend.recentDailyViews)} views/day, was ${formatCompact(p.growth.trend.priorDailyViews)}` : undefined}
                  />
                </td>
                <td className="num"><Delta value={p.growth.d7.subs} pct={p.growth.d7.subsPct} /></td>
                <td className="num">{p.growth.d30 ? <Delta value={p.growth.d30.subs} /> : <span className="intel-muted">—</span>}</td>
                <td className="num"><Delta value={p.growth.d7.views} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ws.competitors.every((p) => p.growth.trend.label === "insufficient") ? (
        <p className="intel-muted">Growth trends appear after about a week of daily snapshots.</p>
      ) : null}
    </Card>
  );
}

function ContentTab({ ws }: { ws: CompetitorWorkspace }) {
  // Your own uploads sit alongside theirs, marked, so you can see how yours land.
  const mine = ws.you ? ws.you.videos.map((v) => ({ ...v, channel: ws.you!.channel })) : [];
  const breakouts = [...ws.breakouts, ...mine.filter((v) => (v.multiplier ?? 0) >= 2 && v.ageHours <= 14 * 24)].sort((a, b) => (b.multiplier ?? 0) - (a.multiplier ?? 0));
  const uploads = [...ws.latestUploads, ...mine.slice(0, 10)].sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  const youId = ws.you?.channel.id;
  return (
    <>
      <Card title="Breakouts right now" subtitle="Last 14 days, beating their channel's normal views">
        {breakouts.length === 0 ? (
          <p className="intel-muted">No breakouts in the last 14 days.</p>
        ) : (
          <ShowMore items={breakouts} first={5} noun="breakouts" render={(items) => (
          <ul className="dash-list">
            {items.map((v) => (
              <li key={v.id} data-you={v.channel.id === youId}>
                <a href={v.format === "short" ? `https://www.youtube.com/shorts/${v.youtube_video_id}` : `https://www.youtube.com/watch?v=${v.youtube_video_id}`} target="_blank" rel="noreferrer" className="dash-row">
                  <Multiplier value={v.multiplier} />
                  <span className="dash-row-main">
                    <span className="dash-row-title">{v.title}</span>
                    <span className="dash-row-sub">
                      {v.channel.id === youId ? "You" : v.channel.title} · {formatCompact(v.view_count)} views · {formatCompact(Math.round(v.vph))}/hr · {timeAgo(v.published_at)}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
          )} />
        )}
      </Card>
      <Card title="Latest uploads" subtitle="Highlighted rows are 3× or more their channel's normal views">
        <ShowMore items={uploads} first={8} noun="uploads" render={(items) => <VideoTable videos={items} showChannel compact />} />
      </Card>
    </>
  );
}

function InsightsTab({ ws }: { ws: CompetitorWorkspace }) {
  return (
    <>
      <Card title="Opportunities" subtitle="Gaps backed by your competitors' results">
        {ws.opportunities.length === 0 ? (
          <p className="intel-muted">{ws.you ? "No clear gaps yet. These appear when competitors get strong, repeated results you're not matching." : "Add your channel to find topic, format, and posting gaps."}</p>
        ) : (
          <ShowMore items={ws.opportunities} first={3} noun="opportunities" render={(items) => (
            <ul className="intel-opps">
              {items.map((o) => (
                <li key={o.title}>
                  <strong>{o.title}</strong>
                  <span>{o.detail}</span>
                </li>
              ))}
            </ul>
          )} />
        )}
      </Card>
      <Card title="What's working" subtitle={`${ws.working.sampleVideos} competitor uploads from the last 60 days · lift = performance vs their uploads overall`}>
        {ws.working.sampleVideos < 3 ? (
          <p className="intel-muted">Patterns appear once competitors have a few saved uploads.</p>
        ) : (
          <div className="intel-working">
            <PatternList title="Topics" items={ws.working.topics} />
            <PatternList title="Formats" items={ws.working.formats} />
            <PatternList title="Title patterns" items={ws.working.titles} />
            <div className="intel-facts">
              <h3 className="dash-subhead">At a glance</h3>
              <dl>
                <div><dt>Uploads/week (median)</dt><dd>{ws.working.medianUploadsPerWeek?.toFixed(1) ?? "—"}</dd></div>
                <div><dt>Short length</dt><dd>{ws.working.medianShortSeconds !== null ? `${ws.working.medianShortSeconds}s` : "—"}</dd></div>
                <div><dt>Long-form length</dt><dd>{ws.working.medianLongMinutes !== null ? `${ws.working.medianLongMinutes} min` : "—"}</dd></div>
                <div><dt>Best upload day (UTC)</dt><dd>{ws.working.bestWeekday ? ws.working.bestWeekday.label : "—"}</dd></div>
              </dl>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

function AlertsTab({ ws }: { ws: CompetitorWorkspace }) {
  return (
    <Card title="Alerts" subtitle="Last 7 days, from scheduled refreshes">
      <form action={saveCompetitorAlerts} className="intel-alert-settings">
        {ALERT_KINDS.map((kind) => (
          <label key={kind} className="checkbox-field">
            <input type="checkbox" name="alerts" value={kind} defaultChecked={ws.enabledAlerts.includes(kind)} />
            <span>{ALERT_LABEL[kind]}</span>
          </label>
        ))}
        <button type="submit" className="button-ghost button-small">
          Save
        </button>
      </form>
      {ws.alerts.length === 0 ? (
        <p className="intel-muted">No alerts in the last 7 days.</p>
      ) : (
        <ul className="dash-alerts">
          {ws.alerts.map((a, i) => (
            <li key={`${a.kind}-${a.channel.id}-${i}`} className="dash-alert" data-tone={a.kind === "uploads" ? "info" : "good"}>
              <strong>{a.title}</strong>
              <span>
                {a.detail} · {timeAgo(a.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PatternList({ title, items }: { title: string; items: PatternStat[] }) {
  return (
    <div>
      <h3 className="dash-subhead">{title}</h3>
      {items.length === 0 ? (
        <p className="intel-muted">Not enough data</p>
      ) : (
        <ul className="intel-patterns">
          {items.slice(0, 3).map((p) => (
            <li key={p.label}>
              <span className="intel-pattern-label">{p.label}</span>
              <span className="intel-muted">
                {p.videos} videos · {formatCompact(p.avgViews)} avg
              </span>
              <span className="intel-lift" data-dir={p.lift === null ? "none" : p.lift >= 1.1 ? "up" : p.lift <= 0.9 ? "down" : "flat"}>
                {p.lift === null ? "—" : `${p.lift.toFixed(2)}×`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
