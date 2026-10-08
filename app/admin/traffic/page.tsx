import { cookies } from "next/headers";
import Link from "next/link";
import type { ComponentType, CSSProperties, ReactNode } from "react";
import { CoinsIcon, EyeIcon, TargetIcon, TrendingIcon, UsersIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth/session";
import { conversion, fillDays, NO_TRACK_COOKIE, type SiteTraffic, type TrafficChannelRow } from "@/lib/analytics/site";
import { getServices } from "@/lib/services";
import { ActivityHeatmap } from "./activity-heatmap";
import { PlatformLogo } from "./platform-logo";
import { TrafficChart, type ChartPoint } from "./traffic-chart";

export const dynamic = "force-dynamic";

const RANGES = [
  { key: "24h", label: "24h", long: "24 hours", days: 1 },
  { key: "7d", label: "7d", long: "7 days", days: 7 },
  { key: "30d", label: "30d", long: "30 days", days: 30 },
  { key: "90d", label: "90d", long: "90 days", days: 90 },
] as const;

const PALETTE = ["#8b5cf6", "#ec4899", "#38bdf8", "#34d399", "#fbbf24", "#f97316", "#64748b"];


const count = (n: number) => n.toLocaleString("en-US");
const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const percent = (value: number | null) => (value === null ? "–" : `${value}%`);
const duration = (seconds: number | null) => {
  if (seconds === null) return "–";
  const s = Math.round(seconds);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};
const share = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

/** Change against the period before, as a whole percent; null when there's nothing to compare with. */
function change(now: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.round(((now - before) / before) * 100);
}

export default async function AdminTrafficPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await requireAdmin();
  const { range: rawRange } = await searchParams;
  const range = RANGES.find((r) => r.key === rawRange) ?? RANGES[1];
  const until = new Date();
  const since = new Date(until.getTime() - range.days * 86_400_000);
  const before = new Date(since.getTime() - range.days * 86_400_000);
  const events = getServices().repositories.siteEvents;
  const [traffic, previous] = await Promise.all([events.traffic(since, until), events.traffic(before, since)]);
  const { funnel } = traffic;
  const paid = funnel.subscribed + funnel.purchases;
  const previousPaid = previous.funnel.subscribed + previous.funnel.purchases;
  const returning = Math.max(0, traffic.visitors - traffic.newVisitors);
  const notCounted = (await cookies()).get(NO_TRACK_COOKIE)?.value === "1";
  const vs = `vs previous ${range.long}`;

  return (
    <div className="stack traffic-page">
      <div className="traffic-top">
        <PageHeader icon={EyeIcon} title="Traffic" subtitle="Who visits Outlier, where they came from and how far they get." />
        <div className="traffic-toolbar">
          <span className="traffic-live">
            <span className="traffic-live-dot" aria-hidden="true" />
            <strong>{count(traffic.live)}</strong> live
          </span>
          <nav className="traffic-segmented" aria-label="Range">
            {RANGES.map((r) => (
              <Link key={r.key} href={`/admin/traffic?range=${r.key}`} aria-current={r.key === range.key ? "page" : undefined} scroll={false}>
                {r.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <div className="traffic-kpis">
        <Kpi icon={UsersIcon} label="Unique visitors" value={count(traffic.visitors)} delta={change(traffic.visitors, previous.visitors)} vs={vs}>
          {count(traffic.newVisitors)} new · {count(returning)} returning
        </Kpi>
        <Kpi icon={TrendingIcon} label="Visits" value={count(traffic.visits)} delta={change(traffic.visits, previous.visits)} vs={vs}>
          {count(traffic.pageviews)} page views
        </Kpi>
        <Kpi icon={TargetIcon} label="Paid" value={count(paid)} delta={change(paid, previousPaid)} vs={vs}>
          {percent(conversion(traffic.visitors, paid))} of visitors · {count(funnel.checkout)} checkouts
        </Kpi>
        <Kpi icon={CoinsIcon} label="Revenue" value={dollars(funnel.revenueCents)} delta={change(funnel.revenueCents, previous.funnel.revenueCents)} vs={vs}>
          Charged at checkout
        </Kpi>
      </div>

      <div className="traffic-split">
        <TrafficChart
          points={chartPoints(traffic, since, until, range.days === 1)}
          hourly={range.days === 1}
          heading={
            <div>
              <h2 className="traffic-card-title">Visitors over time</h2>
              <p className="stat-note">
                {count(traffic.visitors)} visitors in the last {range.long}
              </p>
            </div>
          }
        />
        <div className="traffic-side">
          <Insights traffic={traffic} previous={previous} range={range.long} />
          <Engagement traffic={traffic} />
        </div>
      </div>

      <div className="traffic-sources">
        <section className="card">
          <h2 className="traffic-card-title">Channels</h2>
          <p className="stat-note">What kind of place each visit came from</p>
          <Donut rows={traffic.channels.map((c) => ({ name: c.name, value: c.visits }))} unit="visits" />
        </section>
        <section className="card" id="came-from">
          <h2 className="traffic-card-title">Came from</h2>
          <p className="stat-note">The site, app or link each visit came in on</p>
          <SourceList rows={traffic.platforms} />
        </section>
        <section className="card">
          <h2 className="traffic-card-title">Devices</h2>
          <p className="stat-note">What visitors browse on</p>
          <Donut
            rows={Object.entries(traffic.devices)
              .sort((a, b) => b[1] - a[1])
              .map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value }))}
            unit="visitors"
          />
        </section>
      </div>

      <div className="traffic-pair">
        <section className="card">
          <h2 className="traffic-card-title">When people visit</h2>
          <p className="stat-note">Page views by day and time, in your time zone</p>
          <ActivityHeatmap hours={traffic.hours} />
        </section>
        <Funnel traffic={traffic} />
      </div>

      <SalesTable rows={traffic.platforms} />

      <div className="traffic-pair">
        <TrafficTable
          title="Top pages"
          empty="No page views yet."
          head={["Page", "Views", "Visitors", "Time", "Scroll"]}
          rows={traffic.pages.map((p) => [
            <code key="p">{p.path}</code>,
            count(p.views),
            count(p.visitors),
            duration(p.avgSeconds),
            p.scroll === null ? "–" : <Meter key="s" value={p.scroll} />,
          ])}
        />
        <div className="stack">
          <TrafficTable
            title="Entry pages"
            empty="No visits yet."
            head={["Page", "Visits", "Bounce"]}
            rows={traffic.entryPages.map((p) => [<code key="p">{p.path}</code>, count(p.visits), <BouncePill key="b" value={p.bounceRate} />])}
          />
          <TrafficTable
            title="Links and codes"
            note="Visits on a tagged link (?source= or ?utm_source=), creator code or referral link"
            empty="Nobody has come in on a tagged link, creator code or referral yet."
            head={["Link", "Visitors", "Checkouts"]}
            rows={traffic.sources.map((s) => [s.name, count(s.visitors), s.checkouts > 0 ? <Pill key="c" tone="good">{count(s.checkouts)}</Pill> : "0"])}
          />
        </div>
      </div>

      <footer className="traffic-foot stat-note">
        <p>
          Counted like Plausible and GA4: a visitor is an anonymous first-party id (someone coming back is still one visitor), a visit ends
          after 30 minutes idle, and sales go to the last place a visitor came from. Apps like Discord and iMessage don&apos;t say where a click came
          from, so tag links you post: <code>?source=tiktok</code>, or <code>?code=sktl&amp;source=tiktok</code> for a creator. Admins aren&apos;t
          counted.
        </p>
        <form action="/api/track/opt-out" method="post" className="row" style={{ gap: 8 }}>
          <input type="hidden" name="back" value={`/admin/traffic?range=${range.key}`} />
          {notCounted ? <input type="hidden" name="count" value="1" /> : null}
          <span>{notCounted ? "This browser isn't counted, even signed out." : "Signed out, this browser counts like any visitor."}</span>
          <button type="submit" className="button-ghost">
            {notCounted ? "Count it again" : "Don't count this browser"}
          </button>
        </form>
      </footer>
    </div>
  );
}

/** One point a day, or on the 24-hour view one an hour (from the weekday-and-hour counts, which can't repeat inside a day). */
function chartPoints(traffic: SiteTraffic, since: Date, until: Date, hourly: boolean): ChartPoint[] {
  if (!hourly) return fillDays(traffic.daily, since, until).map((d) => ({ at: d.day, visitors: d.visitors, pageviews: d.pageviews, checkouts: d.checkouts }));
  const byHour = new Map(traffic.hours.map((h) => [`${h.dow}-${h.hour}`, h]));
  const points: ChartPoint[] = [];
  const cursor = new Date(since);
  cursor.setUTCMinutes(0, 0, 0);
  while (cursor <= until) {
    const h = byHour.get(`${cursor.getUTCDay()}-${cursor.getUTCHours()}`);
    points.push({ at: cursor.toISOString(), visitors: h?.visitors ?? 0, pageviews: h?.pageviews ?? 0, checkouts: 0 });
    cursor.setUTCHours(cursor.getUTCHours() + 1);
  }
  return points;
}

function Kpi({
  icon: Icon,
  label,
  value,
  delta,
  vs,
  children,
}: {
  icon: ComponentType<{ size?: number }>;
  label: string;
  value: string;
  delta: number | null;
  vs: string;
  children: ReactNode;
}) {
  const good = delta !== null && delta > 0;
  const bad = delta !== null && delta < 0;
  return (
    <section className="card traffic-kpi">
      <div className="traffic-kpi-head">
        <span className="traffic-kpi-icon">
          <Icon size={16} />
        </span>
        <span className="traffic-kpi-label">{label}</span>
      </div>
      <div className="traffic-kpi-value">{value}</div>
      <div className="traffic-kpi-foot">
        {delta === null ? (
          <span className="traffic-delta" data-tone="flat" title={`Nothing to compare ${vs}`}>
            New
          </span>
        ) : (
          <span className="traffic-delta" data-tone={good ? "good" : bad ? "bad" : "flat"} title={vs}>
            {delta > 0 ? "↑" : delta < 0 ? "↓" : "→"} {Math.abs(delta)}%
          </span>
        )}
        <span className="stat-note">{children}</span>
      </div>
    </section>
  );
}

function Insights({ traffic, previous, range }: { traffic: SiteTraffic; previous: SiteTraffic; range: string }) {
  const lines: ReactNode[] = [];
  const totalVisits = traffic.platforms.reduce((sum, p) => sum + p.visits, 0);
  const named = traffic.platforms.filter((p) => p.name !== "Direct" && p.name !== "Not linked");
  const top = named[0];
  if (top && totalVisits > 0) {
    lines.push(
      <>
        <strong>{top.name}</strong> brought {share(top.visits, totalVisits)}% of visits.
      </>,
    );
  }
  const direct = traffic.platforms.find((p) => p.name === "Direct");
  if (direct && totalVisits > 0 && share(direct.visits, totalVisits) >= 50) {
    lines.push(<>{share(direct.visits, totalVisits)}% of visits don&apos;t say where they came from. Tag links with ?source= to see them.</>);
  }
  const converter = traffic.platforms.filter((p) => p.visits >= 3 && p.paid > 0).sort((a, b) => b.paid / b.visits - a.paid / a.visits)[0];
  if (converter) {
    lines.push(
      <>
        <strong>{converter.name}</strong> converts best: {share(converter.paid, converter.visits)}% of its visits paid.
      </>,
    );
  }
  const visitorsChange = change(traffic.visitors, previous.visitors);
  if (visitorsChange !== null && visitorsChange !== 0) {
    lines.push(
      <>
        Visitors {visitorsChange > 0 ? "up" : "down"} <strong>{Math.abs(visitorsChange)}%</strong> on the {range} before.
      </>,
    );
  }
  const deviceTotal = Object.values(traffic.devices).reduce((a, b) => a + b, 0);
  if (deviceTotal > 0) {
    lines.push(<>{share(traffic.devices.mobile ?? 0, deviceTotal)}% of visitors are on a phone.</>);
  }

  return (
    <section className="traffic-insights">
      <div className="traffic-insights-head">
        <span className="traffic-insights-spark" aria-hidden="true">
          ✦
        </span>
        Insights
      </div>
      {lines.length === 0 ? (
        <p>Not enough visits yet to say much. Share a link and check back.</p>
      ) : (
        <ul>
          {lines.slice(0, 3).map((line, i) => (
            <li key={i} style={{ "--i": i } as CSSProperties}>
              {line}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Engaged visits (the ones that didn't bounce) as a segmented gauge, with time on site under it. */
function Engagement({ traffic }: { traffic: SiteTraffic }) {
  const engaged = traffic.bounceRate === null ? null : Math.round(100 - traffic.bounceRate);
  const SEGMENTS = 24;
  const lit = engaged === null ? 0 : Math.round((engaged / 100) * SEGMENTS);
  return (
    <section className="card traffic-engagement">
      <h2 className="traffic-card-title">Engagement</h2>
      <div className="traffic-gauge" role="img" aria-label={engaged === null ? "No visits yet" : `${engaged}% of visits went past one page`}>
        <svg viewBox="0 0 200 110" aria-hidden="true">
          {Array.from({ length: SEGMENTS }, (_, i) => {
            const angle = Math.PI - (i + 0.5) * (Math.PI / SEGMENTS);
            const x1 = 100 + Math.cos(angle) * 70;
            const y1 = 100 - Math.sin(angle) * 70;
            const x2 = 100 + Math.cos(angle) * 92;
            const y2 = 100 - Math.sin(angle) * 92;
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                className="traffic-gauge-seg"
                data-on={i < lit || undefined}
                style={{ "--i": i } as CSSProperties}
              />
            );
          })}
        </svg>
        <div className="traffic-gauge-value">
          <strong>{engaged === null ? "–" : `${engaged}%`}</strong>
          <span>engaged visits</span>
        </div>
      </div>
      <dl className="traffic-mini">
        <div>
          <dt>Time on site</dt>
          <dd>{duration(traffic.avgVisitSeconds)}</dd>
        </div>
        <div>
          <dt>Pages a visit</dt>
          <dd>{traffic.visits > 0 ? (traffic.pageviews / traffic.visits).toFixed(1) : "–"}</dd>
        </div>
        <div>
          <dt>Bounce rate</dt>
          <dd>{percent(traffic.bounceRate)}</dd>
        </div>
      </dl>
    </section>
  );
}

function Donut({ rows, unit }: { rows: { name: string; value: number }[]; unit: string }) {
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  if (total === 0) return <div className="empty">No {unit} yet.</div>;
  const shown = rows.slice(0, 5);
  const rest = rows.slice(5).reduce((sum, r) => sum + r.value, 0);
  const slices = rest > 0 ? [...shown, { name: "Other", value: rest }] : shown;
  // Where each slice starts, as a share of the ring.
  const starts = slices.map((_, i) => slices.slice(0, i).reduce((sum, s) => sum + (s.value / total) * 100, 0));
  return (
    <div className="traffic-donut">
      <div className="traffic-donut-ring">
        <svg viewBox="0 0 42 42" aria-hidden="true">
          <circle cx="21" cy="21" r="15.915" className="traffic-donut-track" />
          {slices.map((s, i) => {
            const length = (s.value / total) * 100;
            // A hair of space between slices, unless one slice is the whole ring.
            const gap = slices.length > 1 ? Math.min(1.2, length / 3) : 0;
            return (
              <circle
                key={s.name}
                cx="21"
                cy="21"
                r="15.915"
                className="traffic-donut-slice"
                stroke={PALETTE[i % PALETTE.length]}
                strokeDasharray={`${length - gap} ${100 - length + gap}`}
                strokeDashoffset={25 - starts[i]!}
              />
            );
          })}
        </svg>
        <div className="traffic-donut-center">
          <strong>{count(total)}</strong>
          <span>{unit}</span>
        </div>
      </div>
      <ul className="traffic-legend">
        {slices.map((s, i) => (
          <li key={s.name} style={{ "--i": i } as CSSProperties}>
            <span className="traffic-swatch" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="traffic-legend-name">{s.name}</span>
            <span className="traffic-legend-value">{share(s.value, total)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SourceList({ rows }: { rows: TrafficChannelRow[] }) {
  if (rows.length === 0) return <div className="empty">No visits yet.</div>;
  const total = rows.reduce((sum, r) => sum + r.visits, 0);
  const top = Math.max(1, ...rows.map((r) => r.visits));
  return (
    <ul className="traffic-source-list">
      {rows.slice(0, 8).map((r, i) => (
        <li key={r.name} style={{ "--i": i } as CSSProperties}>
          <PlatformLogo name={r.name} />
          <div className="traffic-source-body">
            <div className="traffic-source-line">
              <span className="traffic-source-name">{r.name}</span>
              <span className="traffic-source-count">
                {count(r.visits)} <span className="stat-note">{share(r.visits, total)}%</span>
              </span>
            </div>
            <div className="traffic-source-track">
              <span style={{ width: `${(r.visits / top) * 100}%` }} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Funnel({ traffic }: { traffic: SiteTraffic }) {
  const { funnel } = traffic;
  const paid = funnel.subscribed + funnel.purchases;
  const steps = [
    { label: "Saw the home page", value: funnel.landing, note: "Signed-out visitors on /" },
    { label: "Saw pricing", value: funnel.pricing, note: "Scrolled to pricing, or opened Billing" },
    { label: "Started checkout", value: funnel.checkout, note: "Went to Stripe" },
    { label: "Paid or started a trial", value: paid, note: `${count(funnel.subscribed)} plans, ${count(funnel.purchases)} credit packs` },
  ];
  const top = Math.max(1, ...steps.map((s) => s.value));
  return (
    <section className="card">
      <h2 className="traffic-card-title">Home page to paying</h2>
      <p className="stat-note">How far visitors get{funnel.waitlist > 0 ? ` · ${count(funnel.waitlist)} joined the waitlist` : ""}</p>
      <ol className="traffic-funnel">
        {steps.map((step, i) => (
          <li key={step.label} style={{ "--i": i } as CSSProperties}>
            <div className="traffic-funnel-head">
              <span className="traffic-funnel-step">{i + 1}</span>
              <div>
                <strong>{step.label}</strong>
                <span className="stat-note">{step.note}</span>
              </div>
              <span className="traffic-funnel-value">
                {count(step.value)}
                {i > 0 ? <Pill tone="accent">{percent(conversion(steps[i - 1]!.value, step.value))}</Pill> : null}
              </span>
            </div>
            <div className="traffic-funnel-track">
              <span style={{ width: `${(step.value / top) * 100}%` }} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SalesTable({ rows }: { rows: TrafficChannelRow[] }) {
  return (
    <section className="card">
      <div className="traffic-card-head">
        <div>
          <h2 className="traffic-card-title">Where sales came from</h2>
          <p className="stat-note">Checkouts and payments go to the visitor&apos;s last visit that came from somewhere, as GA4 does it</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="empty">No visits yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="traffic-table">
            <thead>
              <tr>
                <th>Source</th>
                <th className="num">Visits</th>
                <th className="num">Visitors</th>
                <th>Bounce</th>
                <th className="num">Checkouts</th>
                <th>Paid</th>
                <th className="num">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td>
                    <span className="traffic-source-cell">
                      <PlatformLogo name={r.name} />
                      {r.name}
                    </span>
                  </td>
                  <td className="num">{count(r.visits)}</td>
                  <td className="num">{count(r.visitors)}</td>
                  <td>
                    <BouncePill value={r.bounceRate} />
                  </td>
                  <td className="num">{count(r.checkouts)}</td>
                  <td>{r.paid > 0 ? <Pill tone="good">{count(r.paid)} paid</Pill> : <Pill tone="flat">None</Pill>}</td>
                  <td className="num">{r.revenueCents > 0 ? dollars(r.revenueCents) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Pill({ tone, children }: { tone: "good" | "bad" | "warn" | "flat" | "accent"; children: ReactNode }) {
  return (
    <span className="traffic-pill" data-tone={tone}>
      {children}
    </span>
  );
}

function BouncePill({ value }: { value: number | null }) {
  if (value === null) return <>–</>;
  return <Pill tone={value >= 70 ? "bad" : value >= 45 ? "warn" : "good"}>{value}%</Pill>;
}

function Meter({ value }: { value: number }) {
  return (
    <span className="traffic-meter" title={`Scrolled ${value}% down on average`}>
      <span style={{ width: `${value}%` }} />
      <em>{value}%</em>
    </span>
  );
}

function TrafficTable({ title, head, rows, empty, note }: { title: string; head: string[]; rows: ReactNode[][]; empty: string; note?: string }) {
  return (
    <section className="card">
      <h2 className="traffic-card-title">{title}</h2>
      {note ? <p className="stat-note">{note}</p> : null}
      {rows.length === 0 ? (
        <div className="empty">{empty}</div>
      ) : (
        <div className="table-wrap">
          <table className="traffic-table">
            <thead>
              <tr>
                {head.map((h, i) => (
                  <th key={h} className={i > 0 ? "num" : undefined}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, i) => (
                    <td key={i} className={i === 0 ? "traffic-cell-name" : "num"}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
