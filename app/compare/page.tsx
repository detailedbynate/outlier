import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { BookmarkIcon, ChartIcon, CompassIcon, FlameIcon, TrendingIcon, UsersIcon, ZapIcon } from "@/components/icons";
import { ALERT_KINDS, ALERT_LABEL, SORT_OPTIONS, type ComparisonRow, type PatternStat, type SortKey } from "@/lib/competitors/intel";
import { requireApprovedUser } from "@/lib/auth/session";
import { formatCompact, formatPercent, timeAgo } from "@/lib/format";
import { MAX_COMPETITORS } from "@/lib/onboarding/schema";
import { getServices } from "@/lib/services";
import { saveCompetitorAlerts, syncCompetitors } from "./actions";
import { ChannelCell, Delta, Diff, Multiplier, TrendBadge, VideoTable } from "./intel-ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata: Metadata = { title: "Competitors · Outlier" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const STATUS_TEXT: Record<string, { tone: "good" | "warn"; text: string }> = {
  synced: { tone: "good", text: "Channels are up to date. Fresh channels were reused without using YouTube data." },
  rate_limited: { tone: "warn", text: "You've refreshed a lot this hour. Showing stored data." },
  quota: { tone: "warn", text: "YouTube data is at today's limit. Showing stored data, which may be older." },
  error: { tone: "warn", text: "Couldn't refresh right now. Showing stored data." },
};

function Section({ icon: Icon, title, subtitle, action, children, tone = "violet", index = 0 }: {
  icon: typeof UsersIcon;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  tone?: string;
  index?: number;
}) {
  return (
    <section className="dash-panel" style={{ "--i": index } as CSSProperties} aria-label={title}>
      <header className="dash-panel-head">
        <span className="dash-icon" data-tone={tone}>
          <Icon size={16} />
        </span>
        <div className="dash-panel-titles">
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {action ? <div className="dash-panel-action">{action}</div> : null}
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
  const status = typeof params.status === "string" ? (params.status.startsWith("failed") ? "error" : params.status) : null;

  const hasChannels = competitorInputs.length > 0;
  const ws = hasChannels ? await services.competitors.workspace({ you: you || null, competitors: competitorInputs, userId: user.id, sort }) : null;
  const slots = [...competitorInputs, ...Array(MAX_COMPETITORS).fill("")].slice(0, Math.max(5, competitorInputs.length + 1));
  const sortHref = (key: SortKey) => {
    const q = new URLSearchParams();
    if (you) q.set("you", you);
    for (const c of competitorInputs) q.append("c", c);
    q.set("sort", key);
    return `/compare?${q.toString()}`;
  };
  const detailHref = (youtubeId: string) => `/compare/${youtubeId}`;

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
        <span className="intel-muted">Only new or stale channels use YouTube data; everything else loads from Outlier.</span>
        <button type="submit">{hasChannels ? "Update & refresh" : "Start tracking"}</button>
      </div>
    </form>
  );

  return (
    <div className="dash intel">
      <header className="dash-hero">
        <div className="dash-hero-text">
          <span className="dash-eyebrow">
            <UsersIcon size={13} /> Competitive intelligence
          </span>
          <h1>Competitors</h1>
          <p>How you stack up, who&apos;s growing, and what&apos;s working for them right now.</p>
        </div>
        {status && STATUS_TEXT[status] ? (
          <div className="intel-status" data-tone={STATUS_TEXT[status]!.tone} role="status">
            {STATUS_TEXT[status]!.text}
          </div>
        ) : null}
      </header>

      {!hasChannels ? (
        <section className="dash-panel">
          <div className="dash-empty">
            <strong>Track your competitors</strong>
            <p>
              Add your channel and up to {MAX_COMPETITORS} competitors. Outlier keeps them refreshed automatically and shows their growth, breakout videos,
              what&apos;s working, and the gaps you can fill.
            </p>
          </div>
          {channelForm}
        </section>
      ) : ws ? (
        <>
          <details className="intel-edit">
            <summary>
              Tracking {ws.competitors.length} competitor{ws.competitors.length === 1 ? "" : "s"}
              {ws.you ? ` against ${ws.you.channel.title}` : ""} · Edit channels
            </summary>
            {channelForm}
          </details>

          {ws.missing.length > 0 || ws.youPending ? (
            <div className="intel-status" data-tone="warn">
              Not synced yet: {[...(ws.youPending ? [ws.youPending] : []), ...ws.missing].join(", ")}. Use &ldquo;Update &amp; refresh&rdquo; to load them.
            </div>
          ) : null}

          {ws.competitors.length === 0 ? (
            <div className="dash-empty">
              <strong>No competitor data yet</strong>
              <p>Open &ldquo;Edit channels&rdquo; and click Update &amp; refresh to load your competitors.</p>
            </div>
          ) : (
            <>
              {/* 1. Overview */}
              <Section
                icon={UsersIcon}
                title="Competitor overview"
                subtitle="Click a channel for its full profile"
                index={0}
                action={
                  <div className="intel-sort">
                    {SORT_OPTIONS.map((o) => (
                      <Link key={o.key} href={sortHref(o.key)} className="dash-topic" data-mine={o.key === sort} aria-current={o.key === sort}>
                        {o.label}
                      </Link>
                    ))}
                  </div>
                }
              >
                <div className="table-wrap">
                  <table className="intel-table">
                    <thead>
                      <tr>
                        <th>Channel</th>
                        <th>Trend</th>
                        <th className="num">Subs · 7d</th>
                        <th className="num">Total views</th>
                        <th className="num">Views · 7d</th>
                        <th className="num">Avg Shorts</th>
                        <th className="num">Avg long</th>
                        <th className="num">Uploads/wk</th>
                        <th className="num">Views/upload</th>
                        <th className="num">Engagement</th>
                        <th className="num">Outlier rate</th>
                        <th>Best recent</th>
                        <th className="num">Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...(ws.you ? [{ p: ws.you, isYou: true }] : []), ...ws.competitors.map((p) => ({ p, isYou: false }))].map(({ p, isYou }) => (
                        <tr key={p.channel.id} data-you={isYou}>
                          <td>
                            <ChannelCell channel={p.channel} href={detailHref(p.channel.youtube_channel_id)} />
                            {isYou ? <span className="niche-badge">You</span> : null}
                          </td>
                          <td>
                            <TrendBadge
                              label={p.growth.trend.label}
                              title={p.growth.trend.recentDailyViews !== null ? `${formatCompact(p.growth.trend.recentDailyViews)}/day recently vs ${formatCompact(p.growth.trend.priorDailyViews)}/day before` : undefined}
                            />
                          </td>
                          <td className="num">
                            <Delta value={p.growth.d7.subs} pct={p.growth.d7.subsPct} />
                          </td>
                          <td className="num">{formatCompact(p.channel.view_count)}</td>
                          <td className="num">{formatCompact(p.recentViews)}</td>
                          <td className="num">{formatCompact(p.avgShortViews)}</td>
                          <td className="num">{formatCompact(p.avgLongViews)}</td>
                          <td className="num">{p.uploadsPerWeek.toFixed(1)}</td>
                          <td className="num">{formatCompact(p.avgViews)}</td>
                          <td className="num">{formatPercent(p.engagement)}</td>
                          <td className="num">{formatPercent(p.outlierRate, 0)}</td>
                          <td className="intel-best">
                            {p.bestRecent ? (
                              <a href={`https://www.youtube.com/watch?v=${p.bestRecent.youtube_video_id}`} target="_blank" rel="noreferrer" title={p.bestRecent.title}>
                                <Multiplier value={p.bestRecent.multiplier} /> <span>{p.bestRecent.title}</span>
                              </a>
                            ) : (
                              <span className="intel-muted">—</span>
                            )}
                          </td>
                          <td className="num intel-muted">{p.lastUpdated ? timeAgo(p.lastUpdated) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>

              {/* 2. You vs competitors */}
              <Section icon={ChartIcon} title="You vs competitors" subtitle={ws.you ? `${ws.you.channel.title} compared with the average of ${ws.competitors.length} competitors` : undefined} tone="green" index={1}>
                {!ws.you || !ws.comparison ? (
                  <div className="dash-empty">
                    <strong>{ws.youPending ? "Your channel isn't synced yet" : "Add your channel to compare"}</strong>
                    <p>Add your own channel above to see percentage differences against each competitor.</p>
                  </div>
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
                    <div className="table-wrap">
                      <table className="intel-table intel-compare">
                        <thead>
                          <tr>
                            <th>Metric</th>
                            <th className="num">You</th>
                            <th className="num">Competitor avg</th>
                            <th className="num">Difference</th>
                            {ws.competitors.map((c) => (
                              <th key={c.channel.id} className="num" title={c.channel.title}>
                                {c.channel.title.length > 14 ? `${c.channel.title.slice(0, 13)}…` : c.channel.title}
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
                                <td key={c.channelId} className="num" title={c.diff !== null ? `You: ${c.diff > 0 ? "+" : ""}${Math.round(c.diff * 100)}% vs this channel` : undefined}>
                                  {formatRowValue(c.value, row.kind)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="intel-muted">Difference = how you compare with the competitor average. Hover a competitor&apos;s value for your difference against them.</p>
                  </>
                )}
              </Section>

              {/* 3. Growth */}
              <Section icon={TrendingIcon} title="Competitor growth" subtitle="From stored snapshots; trend compares the last 3 days of view velocity with the 4 days before" tone="blue" index={2}>
                <div className="table-wrap">
                  <table className="intel-table">
                    <thead>
                      <tr>
                        <th>Channel</th>
                        <th>Trend</th>
                        <th className="num">Subs 24h</th>
                        <th className="num">Subs 48h</th>
                        <th className="num">Subs 7d</th>
                        <th className="num">Subs 30d</th>
                        <th className="num">Views 24h</th>
                        <th className="num">Views 7d</th>
                        <th className="num">Views/day recent → prior</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ws.competitors.map((p) => (
                        <tr key={p.channel.id} data-highlight={p.growth.trend.label === "accelerating"}>
                          <td>
                            <ChannelCell channel={p.channel} href={detailHref(p.channel.youtube_channel_id)} />
                          </td>
                          <td>
                            <TrendBadge label={p.growth.trend.label} />
                          </td>
                          <td className="num"><Delta value={p.growth.h24.subs} /></td>
                          <td className="num"><Delta value={p.growth.h48.subs} /></td>
                          <td className="num"><Delta value={p.growth.d7.subs} pct={p.growth.d7.subsPct} /></td>
                          <td className="num">{p.growth.d30 ? <Delta value={p.growth.d30.subs} pct={p.growth.d30.subsPct} /> : <span className="intel-muted" title="Needs 30 days of history">—</span>}</td>
                          <td className="num"><Delta value={p.growth.h24.views} /></td>
                          <td className="num"><Delta value={p.growth.d7.views} /></td>
                          <td className="num intel-muted">
                            {p.growth.trend.recentDailyViews !== null ? `${formatCompact(p.growth.trend.recentDailyViews)} → ${formatCompact(p.growth.trend.priorDailyViews)}` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>

              <div className="dash-columns">
                {/* 6. Breakouts */}
                <Section icon={FlameIcon} title="Breakouts right now" subtitle="Last 14 days, beating their channel's normal performance" tone="pink" index={3}>
                  {ws.breakouts.length === 0 ? (
                    <div className="dash-empty">
                      <strong>No breakouts in the last 14 days</strong>
                      <p>Videos at 2× their channel&apos;s normal views (or unusually fast views per hour) show up here.</p>
                    </div>
                  ) : (
                    <ul className="dash-list">
                      {ws.breakouts.map((v) => (
                        <li key={v.id}>
                          <a href={v.format === "short" ? `https://www.youtube.com/shorts/${v.youtube_video_id}` : `https://www.youtube.com/watch?v=${v.youtube_video_id}`} target="_blank" rel="noreferrer" className="dash-row">
                            <Multiplier value={v.multiplier} />
                            <span className="dash-row-main">
                              <span className="dash-row-title">{v.title}</span>
                              <span className="dash-row-sub">
                                {v.channel.title} · {formatCompact(v.view_count)} views · {formatCompact(Math.round(v.vph))}/hr · {timeAgo(v.published_at)}
                                {(v.view_acceleration ?? 0) > 0 ? " · accelerating" : ""}
                              </span>
                            </span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>

                {/* 7. Opportunities */}
                <Section icon={CompassIcon} title="Opportunities" subtitle="Gaps backed by your competitors' measured results" tone="amber" index={4}>
                  {ws.opportunities.length === 0 ? (
                    <div className="dash-empty">
                      <strong>No clear gaps yet</strong>
                      <p>{ws.you ? "Opportunities appear when competitors get strong, repeated results you're not matching." : "Add your channel to find topic, format, and posting gaps."}</p>
                    </div>
                  ) : (
                    <ul className="intel-opps">
                      {ws.opportunities.map((o) => (
                        <li key={o.title} data-kind={o.kind}>
                          <strong>{o.title}</strong>
                          <span>{o.detail}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              </div>

              {/* 5. What's working */}
              <Section icon={ZapIcon} title="What's working" subtitle={`${ws.working.sampleVideos} competitor uploads from the last 60 days · lift = median performance vs all their uploads`} index={5}>
                {ws.working.sampleVideos < 3 ? (
                  <div className="dash-empty">
                    <strong>Not enough uploads yet</strong>
                    <p>Patterns appear once competitors have a few stored uploads.</p>
                  </div>
                ) : (
                  <div className="intel-working">
                    <PatternList title="Topics" items={ws.working.topics} extra={(p) => (p.channels ? `${p.channels} channels` : "")} />
                    <PatternList title="Formats" items={ws.working.formats} />
                    <PatternList title="Long-form length" items={ws.working.lengths} />
                    <PatternList title="Title patterns" items={ws.working.titles} />
                    <div className="intel-facts">
                      <h3 className="dash-subhead">At a glance</h3>
                      <dl>
                        <div><dt>Median uploads/week</dt><dd>{ws.working.medianUploadsPerWeek?.toFixed(1) ?? "—"}</dd></div>
                        <div><dt>Median Short length</dt><dd>{ws.working.medianShortSeconds !== null ? `${ws.working.medianShortSeconds}s` : "—"}</dd></div>
                        <div><dt>Median long-form length</dt><dd>{ws.working.medianLongMinutes !== null ? `${ws.working.medianLongMinutes} min` : "—"}</dd></div>
                        <div><dt>Best upload day (UTC)</dt><dd>{ws.working.bestWeekday ? `${ws.working.bestWeekday.label} · ${ws.working.bestWeekday.medianMultiplier}×` : "—"}</dd></div>
                      </dl>
                    </div>
                  </div>
                )}
              </Section>

              {/* 4. Content intelligence */}
              <Section icon={BookmarkIcon} title="Latest competitor uploads" subtitle="Highlighted rows are 3× or more their channel's normal views" index={6}>
                <VideoTable videos={ws.latestUploads} showChannel />
              </Section>

              {/* 8. Alerts */}
              <Section icon={ZapIcon} title="Alerts" subtitle="From scheduled refreshes, last 7 days. No extra YouTube polling." tone="blue" index={7}>
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
              </Section>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

function PatternList({ title, items, extra }: { title: string; items: PatternStat[]; extra?: (p: PatternStat) => string }) {
  return (
    <div>
      <h3 className="dash-subhead">{title}</h3>
      {items.length === 0 ? (
        <p className="intel-muted">Not enough data</p>
      ) : (
        <ul className="intel-patterns">
          {items.map((p) => (
            <li key={p.label}>
              <span className="intel-pattern-label">{p.label}</span>
              <span className="intel-muted">
                {p.videos} videos · {formatCompact(p.avgViews)} avg{extra && extra(p) ? ` · ${extra(p)}` : ""}
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
