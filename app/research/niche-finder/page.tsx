/* eslint-disable @next/next/no-img-element -- YouTube images are already CDN-optimized */
import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";
import { CompassIcon, FlameIcon, SearchIcon, UsersIcon } from "@/components/icons";
import { requireApprovedUser } from "@/lib/auth/session";
import { isAppError } from "@/lib/core/errors";
import { formatCompact, formatPercent, timeAgo } from "@/lib/format";
import type { Level, NicheMetrics } from "@/lib/niches/analysis";
import { getServices } from "@/lib/services";
import type { NicheResult } from "@/lib/services/niche-service";
import { asUser } from "@/lib/youtube/quota-context";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata: Metadata = { title: "Niche Finder · Outlier" };

const STARTERS = ["gaming", "fitness", "cooking", "personal finance", "tech", "beauty"];
const LEVEL_LABEL: Record<Level, string> = { low: "Low", medium: "Medium", high: "High" };
const FORMAT_LABEL = { shorts: "Shorts", long_form: "Long-form", both: "Both work", unknown: "Not enough data" } as const;

type SearchParams = Promise<{ topic?: string }>;

export default async function NicheFinderPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requireApprovedUser();
  const topic = ((await searchParams).topic ?? "").trim().slice(0, 60);
  const services = getServices();

  let result: NicheResult | null = null;
  let error: string | null = null;
  if (topic) {
    try {
      await services.rateLimits.enforce("nicheUser", user.id);
      result = await asUser(user.id, "page:niche_finder", () => services.niches.research(topic, { userId: user.id }));
    } catch (e) {
      error = isAppError(e) && e.expose ? e.message : "Couldn't research that niche. Try again.";
    }
  }
  const popular = topic ? [] : await services.niches.popularTopics(8);
  const suggestions = [...new Set([...popular.map((p) => p.topic), ...STARTERS])].slice(0, 10);

  return (
    <div className="dash niche">
      <header className="dash-hero">
        <div className="dash-hero-text">
          <span className="dash-eyebrow">
            <CompassIcon size={13} /> Research tool
          </span>
          <h1>Niche Finder</h1>
          <p>Enter a topic to see its sub-niches, how much demand and competition each has, and where the openings are.</p>
        </div>
        <form method="get" action="/research/niche-finder" className="niche-search" role="search">
          <SearchIcon size={18} />
          <label htmlFor="topic" className="sr-only">
            Topic
          </label>
          <input id="topic" name="topic" type="search" defaultValue={topic} placeholder="Try gaming, fitness, cooking…" maxLength={60} autoComplete="off" required />
          <button type="submit">Research</button>
        </form>
        {!topic ? (
          <div className="dash-topics">
            {suggestions.map((s) => (
              <Link key={s} href={`/research/niche-finder?topic=${encodeURIComponent(s)}`} className="dash-topic">
                {s}
              </Link>
            ))}
          </div>
        ) : null}
      </header>

      {error ? <div className="dash-empty">{error}</div> : null}
      {result ? <Report result={result} /> : null}
      {!topic ? (
        <div className="dash-empty">
          <strong>How it works</strong>
          <p>
            Reports are built from Outlier&apos;s stored channels and videos and shared across everyone, so most searches are instant. When a topic has
            too little data, Outlier fetches fresh YouTube data once and saves it for future searches.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Report({ result }: { result: NicheResult }) {
  const { report } = result;
  const overall = report.overall;
  const sourceLabel = result.source === "youtube" ? "Fresh from YouTube" : result.source === "cache" ? "Saved report" : "From Outlier data";

  return (
    <>
      <div className="niche-freshness" data-stale={result.stale}>
        <span className="niche-source" data-source={result.source}>
          {sourceLabel}
        </span>
        <span>
          Updated {timeAgo(result.computedAt)}
          {result.youtubeRefreshedAt ? ` · YouTube data from ${timeAgo(result.youtubeRefreshedAt)}` : ""} · {formatCompact(overall.videos)} videos from{" "}
          {formatCompact(overall.channels)} channels
        </span>
        {result.notice ? <span className="niche-notice">{result.notice}</span> : null}
      </div>

      {overall.videos === 0 ? (
        <div className="dash-empty">
          <strong>No data for “{result.topic}” yet</strong>
          <p>Try a broader topic, or discover channels for it in Shorts Channels so future reports have data to work with.</p>
          <Link href={`/research/shorts-channels?q=${encodeURIComponent(result.topic)}`} className="button-ghost button-small">
            Discover channels
          </Link>
        </div>
      ) : (
        <>
          <section className="dash-panel niche-overview" style={{ "--i": 0 } as CSSProperties}>
            <ScoreRing score={overall.opportunity} label="Opportunity" />
            <div className="niche-overview-main">
              <h2 className="niche-topic">{result.topic}</h2>
              <p className="dash-row-sub">
                Overall topic · {LEVEL_LABEL[overall.confidence]} confidence
              </p>
              <MetricGrid metrics={overall} />
            </div>
          </section>

          <section className="niche-subs" aria-label="Sub-niches">
            <h2 className="dash-subhead">
              <CompassIcon size={14} /> Sub-niches · best opportunities first
            </h2>
            {report.subNiches.length === 0 ? (
              <div className="dash-empty">
                <strong>No clear sub-niches yet</strong>
                <p>There isn&apos;t enough variety in the stored videos to split this topic. The overall numbers above still apply.</p>
              </div>
            ) : (
              <div className="niche-grid">
                {report.subNiches.map((sub, i) => (
                  <article key={sub.term} className="dash-panel niche-card" style={{ "--i": i + 1 } as CSSProperties}>
                    <header className="niche-card-head">
                      <div>
                        <h3>{sub.term}</h3>
                        <span className="dash-row-sub">
                          {sub.metrics.videos} videos · {sub.metrics.channels} channels · {LEVEL_LABEL[sub.metrics.confidence]} confidence
                        </span>
                      </div>
                      <span className="niche-score" data-band={band(sub.metrics.opportunity)}>
                        {sub.metrics.opportunity}
                      </span>
                    </header>
                    <MetricGrid metrics={sub.metrics} compact />
                    <FormatSplit metrics={sub.metrics} />
                    <details className="niche-details">
                      <summary>Top channels and breakout videos</summary>
                      <Lists metrics={sub.metrics} />
                    </details>
                    <Link href={`/research/niche-finder?topic=${encodeURIComponent(sub.term)}`} className="dash-link">
                      Research “{sub.term}” →
                    </Link>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="dash-panel" style={{ "--i": 2 } as CSSProperties}>
            <header className="dash-panel-head">
              <span className="dash-icon" data-tone="pink">
                <FlameIcon size={16} />
              </span>
              <div className="dash-panel-titles">
                <h2>Leaders and breakouts in {result.topic}</h2>
                <p>Who&apos;s winning and which videos beat their channel&apos;s usual views</p>
              </div>
            </header>
            <Lists metrics={overall} />
          </section>
        </>
      )}
    </>
  );
}

function band(score: number): "high" | "mid" | "low" {
  return score >= 65 ? "high" : score >= 45 ? "mid" : "low";
}

function ScoreRing({ score, label }: { score: number; label: string }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="niche-ring" data-band={band(score)} role="img" aria-label={`${label} score ${score} out of 100`}>
      <svg viewBox="0 0 100 100" width="112" height="112" aria-hidden="true">
        <circle cx="50" cy="50" r={radius} className="niche-ring-track" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          className="niche-ring-value"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - score / 100)}
          style={{ "--dash": circumference } as CSSProperties}
        />
      </svg>
      <span className="niche-ring-number">{score}</span>
      <span className="niche-ring-label">{label}</span>
    </div>
  );
}

function MetricGrid({ metrics, compact = false }: { metrics: NicheMetrics; compact?: boolean }) {
  const items: { label: string; value: string; tone?: "good" | "warn" | "bad"; hint: string }[] = [
    { label: "Demand", value: `${LEVEL_LABEL[metrics.demand]} · ${formatCompact(metrics.medianViewsPerDay)}/day`, hint: "Median views per day for recent uploads" },
    { label: "Avg views", value: formatCompact(metrics.avgViews), hint: `Median ${formatCompact(metrics.medianViews)}` },
    {
      label: "Growth",
      value: metrics.growth === null ? "—" : `${metrics.growth > 0 ? "+" : ""}${Math.round(metrics.growth * 100)}%`,
      tone: metrics.growth === null ? undefined : metrics.growth > 0.05 ? "good" : metrics.growth < -0.05 ? "bad" : undefined,
      hint: "Views/day of the last 2 weeks' uploads vs older ones",
    },
    {
      label: "Competition",
      value: LEVEL_LABEL[metrics.competition],
      tone: metrics.competition === "low" ? "good" : metrics.competition === "high" ? "warn" : undefined,
      hint: `Top 3 channels take ${formatPercent(metrics.concentration, 0)} of views`,
    },
    { label: "Active channels", value: `${metrics.activeChannels}`, hint: `${metrics.uploads30d} uploads in 30 days` },
    {
      label: "Viral frequency",
      value: formatPercent(metrics.viralRate, 0),
      tone: metrics.viralRate >= 0.1 ? "good" : undefined,
      hint: `Uploads with 3×+ their channel's usual views${metrics.smallChannelShare !== null ? ` · ${formatPercent(metrics.smallChannelShare, 0)} from channels under 100K` : ""}`,
    },
  ];
  if (!compact) items.push({ label: "Best format", value: FORMAT_LABEL[metrics.format.best], hint: "Compares views per day of Shorts and long-form uploads" });

  return (
    <dl className={`niche-metrics ${compact ? "is-compact" : ""}`}>
      {items.map((item) => (
        <div key={item.label} title={item.hint}>
          <dt>{item.label}</dt>
          <dd data-tone={item.tone}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function FormatSplit({ metrics }: { metrics: NicheMetrics }) {
  const { shorts, longForm, best, shortsViewsPerDay, longViewsPerDay } = metrics.format;
  const total = shorts + longForm;
  if (total === 0) return null;
  const shortsShare = shorts / total;
  return (
    <div className="niche-format" title={`Shorts ${formatCompact(shortsViewsPerDay)}/day · Long-form ${formatCompact(longViewsPerDay)}/day`}>
      <div className="niche-format-bar">
        <span className="is-shorts" style={{ width: `${shortsShare * 100}%` }} />
        <span className="is-long" style={{ width: `${(1 - shortsShare) * 100}%` }} />
      </div>
      <span className="dash-row-sub">
        {shorts} Shorts · {longForm} long-form · <strong>Opportunity: {FORMAT_LABEL[best]}</strong>
      </span>
    </div>
  );
}

function Lists({ metrics }: { metrics: NicheMetrics }) {
  return (
    <div className="niche-lists">
      <div>
        <h4 className="dash-subhead">
          <UsersIcon size={14} /> Top channels
        </h4>
        <ul className="dash-list">
          {metrics.topChannels.map((c) => (
            <li key={c.youtube_channel_id}>
              <Link href={`/channels/${c.youtube_channel_id}`} className="dash-row">
                {c.thumbnail_url ? <img className="dash-avatar" src={c.thumbnail_url} alt="" loading="lazy" /> : <span className="dash-avatar" />}
                <span className="dash-row-main">
                  <span className="dash-row-title">{c.title}</span>
                  <span className="dash-row-sub">
                    {formatCompact(c.subscriber_count)} subs · {c.videos} videos
                  </span>
                </span>
                <span className="dash-metric">{formatCompact(c.views)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="dash-subhead">
          <FlameIcon size={14} /> Breakout videos
        </h4>
        {metrics.breakouts.length === 0 ? (
          <p className="dash-row-sub">No 3×+ breakouts in this sample yet.</p>
        ) : (
          <ul className="dash-list">
            {metrics.breakouts.map((v) => (
              <li key={v.youtube_video_id}>
                <a
                  href={v.format === "short" ? `https://www.youtube.com/shorts/${v.youtube_video_id}` : `https://www.youtube.com/watch?v=${v.youtube_video_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="dash-row"
                >
                  <span className="dash-mult">{v.multiplier}×</span>
                  <span className="dash-row-main">
                    <span className="dash-row-title">{v.title}</span>
                    <span className="dash-row-sub">
                      {v.channel_title} · {formatCompact(v.view_count)} views · {timeAgo(v.published_at)}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
