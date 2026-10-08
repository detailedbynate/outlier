import Link from "next/link";
import { EyeIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { requireAdmin } from "@/lib/auth/session";
import { conversion, fillDays } from "@/lib/analytics/site";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

const RANGES = [
  { key: "24h", label: "24 hours", days: 1 },
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
] as const;

const count = (n: number) => n.toLocaleString("en-US");
const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const percent = (value: number | null) => (value === null ? "–" : `${value}%`);

export default async function AdminTrafficPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await requireAdmin();
  const { range: rawRange } = await searchParams;
  const range = RANGES.find((r) => r.key === rawRange) ?? RANGES[1];
  const until = new Date();
  const since = new Date(until.getTime() - range.days * 86_400_000);
  const traffic = await getServices().repositories.siteEvents.traffic(since, until);
  const days = fillDays(traffic.daily, since, until);
  const peak = Math.max(1, ...days.map((d) => d.visitors));
  const { funnel } = traffic;
  const paid = funnel.subscribed + funnel.purchases;
  const steps = [
    { label: "Saw the home page", value: funnel.landing, note: "Signed-out visitors on /" },
    { label: "Saw pricing", value: funnel.pricing, note: "Scrolled to pricing, or opened Billing" },
    { label: "Started checkout", value: funnel.checkout, note: "Went to Stripe" },
    { label: "Paid or started a trial", value: paid, note: `${count(funnel.subscribed)} plans, ${count(funnel.purchases)} credit packs` },
  ];
  const top = Math.max(1, ...steps.map((s) => s.value));
  const deviceTotal = Object.values(traffic.devices).reduce((a, b) => a + b, 0);

  return (
    <div className="stack">
      <PageHeader
        icon={EyeIcon}
        title="Traffic"
        subtitle="Who visits Outlier and how far they get. No cookies: each visitor is an anonymous id that resets daily, so one person on three days counts three times. Admins aren't counted."
      />

      <div className="row traffic-toolbar">
        <div className="chips">
          {RANGES.map((r) => (
            <Link key={r.key} href={`/admin/traffic?range=${r.key}`} className="chip" aria-current={r.key === range.key}>
              {r.label}
            </Link>
          ))}
        </div>
        <span className="traffic-live">
          <span className="traffic-live-dot" aria-hidden="true" />
          {count(traffic.live)} on the site in the last 30 min
        </span>
      </div>

      <div className="grid grid-4">
        <StatTile label="Visitors" value={count(traffic.visitors)} note={`${count(traffic.publicVisitors)} not signed in`} />
        <StatTile label="Page views" value={count(traffic.pageviews)} />
        <StatTile label="Checkouts started" value={count(funnel.checkout)} note={`${percent(conversion(traffic.visitors, funnel.checkout))} of visitors`} />
        <StatTile label="Paid" value={count(paid)} note={`${dollars(funnel.revenueCents)} at checkout`} />
      </div>

      {range.days > 1 ? (
        <section className="card">
          <h2 className="section-title">Visitors a day</h2>
          <div className="traffic-chart" role="img" aria-label="Visitors per day">
            {days.map((d) => (
              <div
                key={d.day}
                className="traffic-bar"
                title={`${d.day}: ${count(d.visitors)} visitors, ${count(d.pageviews)} views, ${count(d.checkouts)} checkouts, ${count(d.paid)} paid`}
              >
                <div className="traffic-bar-fill" style={{ height: `${(d.visitors / peak) * 100}%` }}>
                  {d.checkouts > 0 ? <span className="traffic-bar-mark" /> : null}
                </div>
              </div>
            ))}
          </div>
          <div className="traffic-chart-axis stat-note">
            <span>{days[0]?.day}</span>
            <span>Peak {count(peak)} · dot = a checkout started</span>
            <span>{days.at(-1)?.day}</span>
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2 className="section-title">Home page to paying</h2>
        <div className="traffic-funnel">
          {steps.map((step, i) => (
            <div key={step.label} className="traffic-step">
              <div className="traffic-step-head">
                <strong>{step.label}</strong>
                <span>
                  {count(step.value)}
                  {i > 0 ? <span className="stat-note"> · {percent(conversion(steps[i - 1]!.value, step.value))} of the step before</span> : null}
                </span>
              </div>
              <div className="traffic-step-track">
                <div className="traffic-step-fill" style={{ width: `${(step.value / top) * 100}%` }} />
              </div>
              <div className="stat-note">{step.note}</div>
            </div>
          ))}
        </div>
        {funnel.waitlist > 0 ? <p className="stat-note">{count(funnel.waitlist)} joined the waitlist.</p> : null}
      </section>

      <div className="grid grid-2">
        <TrafficTable title="Top pages" empty="No page views yet." head={["Page", "Views", "Visitors"]} rows={traffic.pages.map((p) => [p.path, count(p.views), count(p.visitors)])} />
        <TrafficTable
          title="Came from"
          empty="No other sites yet. Direct visits don't show here."
          head={["Site", "Visitors"]}
          rows={traffic.referrers.map((r) => [r.name, count(r.visitors)])}
        />
        <TrafficTable
          title="Links and codes"
          empty="Nobody has come in on a tagged link, creator code or referral yet."
          head={["Source", "Visitors", "Checkouts"]}
          rows={traffic.sources.map((s) => [s.name, count(s.visitors), count(s.checkouts)])}
        />
        <TrafficTable
          title="Devices"
          empty="No visitors yet."
          head={["Device", "Visitors", "Share"]}
          rows={Object.entries(traffic.devices)
            .sort((a, b) => b[1] - a[1])
            .map(([device, n]) => [device, count(n), percent(conversion(deviceTotal, n))])}
        />
      </div>
    </div>
  );
}

function TrafficTable({ title, head, rows, empty }: { title: string; head: string[]; rows: string[][]; empty: string }) {
  return (
    <section className="card">
      <h2 className="section-title">{title}</h2>
      {rows.length === 0 ? (
        <div className="empty">{empty}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {head.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, i) => (
                    <td key={i} className={i === 0 ? "traffic-cell-name" : undefined}>
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
