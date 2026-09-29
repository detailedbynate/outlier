import type { Metadata } from "next";
import Link from "next/link";
import { CompassIcon } from "@/components/icons";
import { requireApprovedUser } from "@/lib/auth/session";
import { isAppError } from "@/lib/core/errors";
import { formatCompact, formatPercent } from "@/lib/format";
import type { NicheMetrics } from "@/lib/niches/analysis";
import { estimateEarnings, formatMoneyRange } from "@/lib/niches/revenue";
import { getServices } from "@/lib/services";
import type { NicheResult } from "@/lib/services/niche-service";
import { asUser } from "@/lib/youtube/quota-context";
import { ScoreBreakdown, TrendChart } from "../insights";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata: Metadata = { title: "Compare niches · Outlier" };

type SearchParams = Promise<{ a?: string; b?: string }>;

const LEVEL = { low: "Low", medium: "Medium", high: "High" } as const;
const FORMAT = { shorts: "Shorts", long_form: "Long-form", both: "Both work", unknown: "Not enough data" } as const;

interface Row {
  label: string;
  hint: string;
  show: (m: NicheMetrics, topic: string) => string;
  /** Higher is better when positive, lower is better when negative; null for no winner. */
  better: ((m: NicheMetrics) => number) | null;
}

const ROWS: Row[] = [
  { label: "Opportunity", hint: "The overall score, out of 100", show: (m) => String(m.opportunity), better: (m) => m.opportunity },
  { label: "Demand", hint: "Views a day for a typical recent upload", show: (m) => `${LEVEL[m.demand]} · ${formatCompact(m.medianViewsPerDay)}/day`, better: (m) => m.medianViewsPerDay },
  {
    label: "Momentum",
    hint: "Newest uploads' views a day vs older ones",
    show: (m) => (m.growth === null ? "—" : `${m.growth >= 0 ? "+" : ""}${Math.round(m.growth * 100)}%`),
    better: (m) => m.growth ?? -Infinity,
  },
  { label: "Competition", hint: "Lower is easier to break into", show: (m) => `${LEVEL[m.competition]} · top 3 take ${formatPercent(m.concentration, 0)}`, better: (m) => -m.concentration },
  { label: "Breakouts", hint: "Uploads with 3× their channel's usual views", show: (m) => formatPercent(m.viralRate, 0), better: (m) => m.viralRate },
  {
    label: "Small channels",
    hint: "Share of breakouts from channels under 100K",
    show: (m) => (m.smallChannelShare === null ? "—" : formatPercent(m.smallChannelShare, 0)),
    better: (m) => m.smallChannelShare ?? -Infinity,
  },
  { label: "Typical channel / month", hint: "Views on a typical channel's last 30 days of uploads", show: (m) => formatCompact(m.monthlyViews?.typical ?? 0), better: (m) => m.monthlyViews?.typical ?? 0 },
  {
    label: "Typical earnings / month",
    hint: "Estimated from category RPMs and those views",
    show: (m, topic) => {
      const money = estimateEarnings(m.monthlyViews, topic);
      return money ? `~${formatMoneyRange(money.typicalMonthly)}` : "—";
    },
    better: null,
  },
  { label: "Active channels", hint: "Channels that uploaded in the last 30 days", show: (m) => String(m.activeChannels), better: null },
  { label: "Best format", hint: "Shorts vs long-form views a day", show: (m) => FORMAT[m.format.best], better: null },
  { label: "Confidence", hint: "How much data the report is built on", show: (m) => `${LEVEL[m.confidence]} · ${formatCompact(m.videos)} videos`, better: null },
];

async function research(userId: string, topic: string): Promise<{ result: NicheResult | null; error: string | null }> {
  const services = getServices();
  try {
    await services.rateLimits.enforce("nicheUser", userId);
    return { result: await asUser(userId, "page:niche_compare", () => services.niches.research(topic, { userId })), error: null };
  } catch (e) {
    return { result: null, error: isAppError(e) && e.expose ? e.message : `Couldn't research “${topic}”.` };
  }
}

export default async function CompareNichesPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requireApprovedUser();
  const params = await searchParams;
  const a = (params.a ?? "").trim().slice(0, 60);
  const b = (params.b ?? "").trim().slice(0, 60);
  const ready = a.length >= 2 && b.length >= 2;
  // One at a time: two reports at once would double the load on a cold cache for no gain.
  const left = ready ? await research(user.id, a) : null;
  const right = ready ? await research(user.id, b) : null;

  return (
    <div className="dash niche niche-compare">
      <header className="dash-hero">
        <div className="dash-hero-text">
          <span className="dash-eyebrow">
            <CompassIcon size={13} /> Niche Finder
          </span>
          <h1>Compare niches</h1>
          <p>Two niches side by side, so you can pick one. The better number in each row is highlighted.</p>
        </div>
        <form method="get" action="/research/niche-finder/compare" className="niche-compare-form">
          <input name="a" defaultValue={a} placeholder="First niche" maxLength={60} required aria-label="First niche" autoComplete="off" />
          <span>vs</span>
          <input name="b" defaultValue={b} placeholder="Second niche" maxLength={60} required aria-label="Second niche" autoComplete="off" />
          <button type="submit">Compare</button>
        </form>
        <Link href="/research/niche-finder" className="dash-link">
          ← Back to Niche Finder
        </Link>
      </header>

      {left?.error ? <div className="dash-empty">{left.error}</div> : null}
      {right?.error ? <div className="dash-empty">{right.error}</div> : null}

      {left?.result && right?.result ? <Comparison left={left.result} right={right.result} /> : null}
    </div>
  );
}

function Comparison({ left, right }: { left: NicheResult; right: NicheResult }) {
  const [l, r] = [left.report.overall, right.report.overall];
  const lead = l.opportunity === r.opportunity ? null : l.opportunity > r.opportunity ? left.topic : right.topic;
  const niche = (result: NicheResult) => `/research/niche-finder?topic=${encodeURIComponent(result.topic)}`;

  return (
    <>
      <p className="niche-compare-verdict">
        {lead ? (
          <>
            <strong>{lead}</strong> scores higher overall ({Math.max(l.opportunity, r.opportunity)} vs {Math.min(l.opportunity, r.opportunity)}). Check the rows below for where
            each one wins.
          </>
        ) : (
          <>They score the same overall ({l.opportunity}). The rows below show where each one wins.</>
        )}
      </p>

      <div className="niche-compare-table" role="table" aria-label={`${left.topic} vs ${right.topic}`}>
        <div className="niche-compare-row niche-compare-headrow" role="row">
          <span role="columnheader" />
          <Link role="columnheader" href={niche(left)} className="niche-compare-name">
            {left.topic}
          </Link>
          <Link role="columnheader" href={niche(right)} className="niche-compare-name">
            {right.topic}
          </Link>
        </div>
        {ROWS.map((row) => {
          const [lv, rv] = row.better ? [row.better(l), row.better(r)] : [0, 0];
          const winner = !row.better || lv === rv ? null : lv > rv ? "left" : "right";
          return (
            <div key={row.label} className="niche-compare-row" role="row">
              <span role="rowheader" className="niche-compare-label" title={row.hint}>
                {row.label}
                <em>{row.hint}</em>
              </span>
              <span role="cell" data-win={winner === "left" || undefined}>
                {row.show(l, left.topic)}
              </span>
              <span role="cell" data-win={winner === "right" || undefined}>
                {row.show(r, right.topic)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="niche-compare-cols">
        {[left, right].map((result) => (
          <div key={result.topicKey} className="niche-compare-col">
            <h2>{result.topic}</h2>
            <ScoreBreakdown metrics={result.report.overall} />
            <TrendChart weekly={result.report.overall.weekly} />
          </div>
        ))}
      </div>
    </>
  );
}
