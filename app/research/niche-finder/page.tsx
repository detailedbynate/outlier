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
import { parseNicheQuery } from "@/lib/niches/query";
import type { NicheCreator, NicheExample } from "@/lib/niches/examples";
import { reasonFor, type NicheIdea, type NicheResult } from "@/lib/services/niche-service";
import { asUser } from "@/lib/youtube/quota-context";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata: Metadata = { title: "Niche Finder · Outlier" };

const STARTERS = ["gaming", "fitness", "cooking", "personal finance", "tech", "beauty"];
const EXAMPLES = ["good niches around fitness", "underrated niches right now", "what should I post about gaming"];
const LEVEL_LABEL: Record<Level, string> = { low: "Low", medium: "Medium", high: "High" };
const FORMAT_LABEL = { shorts: "Shorts", long_form: "Long-form", both: "Both work", unknown: "Not enough data" } as const;

type SearchParams = Promise<{ topic?: string }>;

export default async function NicheFinderPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requireApprovedUser();
  const asked = ((await searchParams).topic ?? "").trim().slice(0, 120);
  // "good niches around fitness" and "fitness" both work; "top niches" browses.
  const { intent, topic } = parseNicheQuery(asked);
  const services = getServices();

  let result: NicheResult | null = null;
  let error: string | null = null;
  if (intent === "research" && topic) {
    try {
      await services.rateLimits.enforce("nicheUser", user.id);
      result = await asUser(user.id, "page:niche_finder", () => services.niches.research(topic, { userId: user.id }));
    } catch (e) {
      error = isAppError(e) && e.expose ? e.message : "Couldn't research that niche. Try again.";
    }
  }
  const thin = !result || result.report.overall.videos === 0;
  const [popular, allTop, related] = await Promise.all([
    result ? Promise.resolve([]) : services.niches.popularTopics(8),
    services.niches.topNiches(12),
    result ? services.niches.relatedNiches(result.topic, result.report, 6) : Promise.resolve([]),
  ]);
  // After a report, keep the exploring going: overlapping niches if we have them, otherwise the best ones we know.
  const topNiches = allTop.filter((idea) => idea.topicKey !== result?.topicKey).slice(0, result ? 6 : 12);
  const suggestions = [...new Set([...popular.map((p) => p.topic), ...STARTERS])].slice(0, 10);

  return (
    <div className="dash niche">
      <header className="dash-hero">
        <div className="dash-hero-text">
          <span className="dash-eyebrow">
            <CompassIcon size={13} /> Research tool
          </span>
          <h1>Niche Finder</h1>
          <p>Ask for a topic or for ideas — &ldquo;good niches around fitness&rdquo;, &ldquo;underrated niches&rdquo; — to see demand, competition and where the openings are.</p>
        </div>
        <form method="get" action="/research/niche-finder" className="niche-search" role="search">
          <SearchIcon size={18} />
          <label htmlFor="topic" className="sr-only">
            Topic
          </label>
          <input id="topic" name="topic" type="search" defaultValue={asked} placeholder="Try “good niches around fitness” or “top niches”" maxLength={120} autoComplete="off" required />
          <button type="submit">Research</button>
        </form>
        {result ? null : (
          <div className="dash-topics">
            {suggestions.map((s) => (
              <Link key={s} href={`/research/niche-finder?topic=${encodeURIComponent(s)}`} className="dash-topic">
                {s}
              </Link>
            ))}
          </div>
        )}
      </header>

      {error ? <div className="dash-empty">{error}</div> : null}
      {result ? <Report result={result} /> : null}
      {related.length > 0 ? <IdeaBoard ideas={related} title={`Niches next to ${result!.topic}`} sub="Other researched topics that overlap with this one" /> : null}
      {topNiches.length > 0 && (related.length === 0 || thin) ? (
        <IdeaBoard
          ideas={topNiches}
          featured={result ? 0 : 3}
          title={result ? "Other underrated niches" : "Underrated niches right now"}
          sub="Mined from every channel Outlier tracks: real demand, room left, and small channels winning. Pick one to dig in."
        />
      ) : null}
      {!result && topNiches.length > 0 && topNiches.length < 4 ? (
        <p className="dash-row-sub niche-ideas-sub">
          Only {topNiches.length} niche{topNiches.length === 1 ? "" : "s"} clear the bar so far — the list grows as more channels are tracked.
        </p>
      ) : null}
      {!result && topNiches.length === 0 ? (
        <div className="dash-empty">
          <strong>Not sure what to search?</strong>
          <p>Try one of these: {EXAMPLES.map((e) => `“${e}”`).join(", ")}. Any topic works, and the report shows its sub-niches.</p>
        </div>
      ) : null}
    </div>
  );
}

function Report({ result }: { result: NicheResult }) {
  const { report } = result;
  const overall = report.overall;
  const sourceLabel = result.source === "youtube" ? "Fresh from YouTube" : result.source === "cache" ? "Saved report" : "From Outlier data";
  const top = report.subNiches.slice(0, 3);

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
        <section className="niche-answer" aria-label={`Top niches in ${result.topic}`}>
          <header className="niche-answer-head">
            <h2>
              {top.length > 0 ? `Top ${top.length} niche${top.length === 1 ? "" : "s"} in ` : ""}
              <span>{result.topic}</span>
            </h2>
            <span className="niche-score" data-band={band(overall.opportunity)} title="Opportunity for the topic as a whole">
              {overall.opportunity}
            </span>
          </header>

          {top.length === 0 ? (
            <div className="dash-empty">
              <strong>No clear niches inside “{result.topic}” yet</strong>
              <p>There isn&apos;t enough variety in the stored videos to split this topic. The topic details below still apply.</p>
            </div>
          ) : (
            <div className="niche-cards">
              {top.map((sub, i) => (
                <NicheCard
                  key={sub.term}
                  rank={i + 1}
                  name={sub.term}
                  score={sub.metrics.opportunity}
                  reason={reasonFor(sub.metrics)}
                  metrics={sub.metrics}
                  examples={sub.examples ?? breakoutExamples(sub.metrics)}
                  creators={sub.creators ?? []}
                />
              ))}
            </div>
          )}

          <details className="niche-topic-details">
            <summary>Topic details for {result.topic}</summary>
            <div className="niche-overview">
              <ScoreRing score={overall.opportunity} label="Opportunity" />
              <div className="niche-overview-main">
                <p className="dash-row-sub">Whole topic · {LEVEL_LABEL[overall.confidence]} confidence</p>
                <MetricGrid metrics={overall} />
              </div>
            </div>
            <Lists metrics={overall} />
          </details>
        </section>
      )}
    </>
  );
}

/** Older cached reports have breakouts but no examples. */
function breakoutExamples(metrics: NicheMetrics): NicheExample[] {
  return metrics.breakouts.map((b) => ({
    youtubeVideoId: b.youtube_video_id,
    title: b.title,
    channelTitle: b.channel_title,
    views: b.view_count,
    subscribers: null,
    publishedAt: b.published_at,
  }));
}

function IdeaBoard({ ideas, title, sub, featured = 0 }: { ideas: NicheIdea[]; title: string; sub: string; featured?: number }) {
  const top = ideas.slice(0, featured);
  const rest = ideas.slice(featured);
  return (
    <section className="niche-ideas" aria-label={title}>
      <h2 className="dash-subhead">
        <CompassIcon size={14} /> {title}
      </h2>
      <p className="dash-row-sub niche-ideas-sub">{sub}</p>
      {top.length > 0 ? (
        <div className="niche-cards">
          {top.map((idea, i) => (
            <NicheCard
              key={idea.topicKey}
              rank={i + 1}
              name={idea.topic}
              score={idea.opportunity}
              reason={idea.reason}
              tags={{ demand: idea.demand, competition: idea.competition, format: idea.format, smallShare: idea.smallChannelShare }}
              examples={idea.examples}
              creators={idea.creators}
            />
          ))}
        </div>
      ) : null}
      {rest.length > 0 ? (
        <div className="niche-idea-grid">
          {rest.map((idea, i) => (
            <Link
              key={idea.topicKey}
              href={`/research/niche-finder?topic=${encodeURIComponent(idea.topic)}`}
              className="dash-panel niche-idea"
              style={{ "--i": i + 1 } as CSSProperties}
            >
              <header className="niche-idea-head">
                <h3>{idea.topic}</h3>
                <span className="niche-score" data-band={band(idea.opportunity)}>
                  {idea.opportunity}
                </span>
              </header>
              <p className="niche-idea-reason">{idea.reason}</p>
              <IdeaTags demand={idea.demand} competition={idea.competition} format={idea.format} smallShare={idea.smallChannelShare} />
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}

interface TagValues {
  demand: Level;
  competition: Level;
  format: keyof typeof FORMAT_LABEL;
  smallShare: number | null;
}

function IdeaTags({ demand, competition, format, smallShare }: TagValues) {
  return (
    <div className="niche-idea-tags">
      <span>{LEVEL_LABEL[demand]} demand</span>
      <span>{LEVEL_LABEL[competition]} competition</span>
      <span>{FORMAT_LABEL[format]}</span>
      {smallShare !== null ? <span>{formatPercent(smallShare, 0)} small channels</span> : null}
    </div>
  );
}

/**
 * One niche answer: why it's worth it and one example that proves it. "See more"
 * opens the rest of the examples, the small creators behind them, and the numbers.
 */
function NicheCard({
  rank,
  name,
  score,
  reason,
  examples,
  creators,
  metrics,
  tags,
}: {
  rank: number;
  name: string;
  score: number;
  reason: string;
  examples: NicheExample[];
  creators: NicheCreator[];
  metrics?: NicheMetrics;
  tags?: TagValues;
}) {
  const [lead, ...more] = examples;
  const tagValues: TagValues | undefined = metrics
    ? { demand: metrics.demand, competition: metrics.competition, format: metrics.format.best, smallShare: metrics.smallChannelShare }
    : tags;

  return (
    <article className="dash-panel niche-feature" style={{ "--i": rank } as CSSProperties}>
      <header className="niche-feature-head">
        <span className="niche-feature-rank">#{rank}</span>
        <div className="niche-feature-titles">
          <h3>{name}</h3>
          <p>{reason}</p>
        </div>
        <span className="niche-score" data-band={band(score)}>
          {score}
        </span>
      </header>

      {lead ? <ExampleVideo example={lead} featured /> : <p className="dash-row-sub">No example videos stored yet.</p>}

      <details className="niche-more">
        <summary>See more</summary>
        <div className="niche-more-body">
          {tagValues ? <IdeaTags {...tagValues} /> : null}
          {more.length > 0 ? (
            <div className="niche-examples">
              {more.slice(0, 5).map((example) => (
                <ExampleVideo key={example.youtubeVideoId} example={example} />
              ))}
            </div>
          ) : null}
          {creators.length > 0 ? (
            <div className="niche-creators">
              <span className="niche-creators-label">Small creators winning here</span>
              <div className="niche-creator-list">
                {creators.map((creator) => (
                  <a
                    key={creator.youtubeChannelId}
                    href={`https://www.youtube.com/channel/${creator.youtubeChannelId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="niche-creator"
                  >
                    {creator.thumbnailUrl ? <img src={creator.thumbnailUrl} alt="" loading="lazy" /> : <span className="niche-creator-blank" />}
                    <span>
                      <strong>{creator.title}</strong>
                      <em>
                        {creator.subscribers !== null ? `${formatCompact(creator.subscribers)} subs · ` : ""}
                        {formatCompact(creator.avgViews)} avg views
                      </em>
                    </span>
                  </a>
                ))}
              </div>
            </div>
          ) : null}
          {metrics ? <MetricGrid metrics={metrics} compact /> : null}
          <Link href={`/research/niche-finder?topic=${encodeURIComponent(name)}`} className="dash-link">
            Dig into {name} →
          </Link>
        </div>
      </details>
    </article>
  );
}

function ExampleVideo({ example, featured = false }: { example: NicheExample; featured?: boolean }) {
  return (
    <a
      href={`https://www.youtube.com/shorts/${example.youtubeVideoId}`}
      target="_blank"
      rel="noreferrer"
      className={`niche-example ${featured ? "is-featured" : ""}`}
    >
      <span className="niche-example-thumb">
        <img src={`https://i.ytimg.com/vi/${example.youtubeVideoId}/hqdefault.jpg`} alt="" loading="lazy" />
        <span className="niche-example-views">{formatCompact(example.views)} views</span>
      </span>
      <span className="niche-example-text">
        <span className="niche-example-title">{example.title}</span>
        <span className="niche-example-channel">
          {example.channelTitle}
          {example.subscribers !== null ? ` · ${formatCompact(example.subscribers)} subs` : ""}
        </span>
      </span>
    </a>
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
