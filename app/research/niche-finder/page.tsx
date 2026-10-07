/* eslint-disable @next/next/no-img-element -- YouTube images are already CDN-optimized */
import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";
import { CompassIcon, FlameIcon, SearchIcon, UsersIcon } from "@/components/icons";
import { requireApprovedUser } from "@/lib/auth/session";
import { Paywall } from "@/components/paywall";
import { paidFeaturesLocked } from "@/lib/billing/feature-gate";
import { PAID_FEATURES } from "@/lib/billing/features";
import { isAppError } from "@/lib/core/errors";
import { formatCompact, formatPercent, timeAgo } from "@/lib/format";
import { topicKey, type Level, type NicheMetrics, type SubNiche, type ViralChannel } from "@/lib/niches/analysis";
import { estimateEarnings, formatMoney, formatMoneyRange, type NicheEarnings } from "@/lib/niches/revenue";
import { getServices } from "@/lib/services";
import { parseNicheQuery } from "@/lib/niches/query";
import type { NicheCreator, NicheExample } from "@/lib/niches/examples";
import { reasonFor, type NicheIdea, type NicheResult } from "@/lib/services/niche-service";
import { asUser } from "@/lib/youtube/quota-context";
import { nicheFit, type OwnChannelMonth } from "@/lib/niches/fit";
import { isSaved, readSavedNiches } from "@/lib/niches/saved";
import { CompareBox, FitPanel, Patterns, SaveNicheButton, SavedNiches, ScoreBreakdown, TrendChart } from "./insights";
import { TopicInput } from "./topic-input";
import { rpmTierOf, sortDiscovered, type DiscoveredNiche, type DiscoverFormat, type DiscoverSort } from "@/lib/niches/discover";
import type { RadarNiche } from "@/lib/services/niche-radar-service";
import type { NicheIdeaRow } from "@/types/database";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata: Metadata = { title: "Niche Finder · Outlier" };

const STARTERS = ["gaming", "fitness", "cooking", "personal finance", "tech", "beauty"];
const LEVEL_LABEL: Record<Level, string> = { low: "Low", medium: "Medium", high: "High" };
const FORMAT_LABEL = { shorts: "Shorts", long_form: "Long-form", both: "Both work", unknown: "Not enough data" } as const;

type SearchParams = Promise<{ topic?: string; sub?: string; format?: string; rpm?: string; sort?: string; board?: string }>;

const SORTS: { value: DiscoverSort; label: string }[] = [
  { value: "best", label: "Best overall" },
  { value: "rpm", label: "Highest RPM" },
  { value: "views", label: "Most views" },
  { value: "untapped", label: "Most untapped" },
  { value: "easy", label: "Easiest to make" },
];
const RPM_FILTERS = [
  { value: "all", label: "Any RPM" },
  { value: "high", label: "High RPM" },
  { value: "mid", label: "Mid RPM" },
  { value: "low", label: "Low RPM" },
] as const;
type RpmFilter = (typeof RPM_FILTERS)[number]["value"];
const BOARDS = [
  { value: "library", label: "Tracked channels" },
  { value: "gaps", label: "Search gaps" },
  { value: "ideas", label: "Video ideas" },
] as const;
type Board = (typeof BOARDS)[number]["value"];
type View = { format: DiscoverFormat; rpm: RpmFilter; sort: DiscoverSort; board: Board };

export default async function NicheFinderPage({ searchParams }: { searchParams: SearchParams }) {
  const current = await requireApprovedUser();
  const { user } = current;
  // Free is Shorts Channels only: show the paywall before loading anything.
  if (await paidFeaturesLocked(current)) return <Paywall feature={PAID_FEATURES["niche-finder"]} />;
  const params = await searchParams;
  const asked = (params.topic ?? "").trim().slice(0, 120);
  // "Dig into X" drills into one sub-niche of the topic already researched. It
  // is never researched on its own: "escape" inside "steal a brainrot" means
  // nothing away from its topic, and looking it up alone returns a different
  // subject entirely.
  const drill = (params.sub ?? "").trim().slice(0, 120);
  // "good niches around fitness" and "fitness" both work; "top niches" browses.
  const { intent, topic } = parseNicheQuery(asked);
  const services = getServices();
  const view = {
    format: (params.format === "long_form" ? "long_form" : "shorts") as DiscoverFormat,
    rpm: (RPM_FILTERS.some((f) => f.value === params.rpm) ? params.rpm : "all") as RpmFilter,
    sort: (SORTS.find((s) => s.value === params.sort)?.value ?? "best") as DiscoverSort,
    board: (BOARDS.find((b) => b.value === params.board)?.value ?? "library") as Board,
  };
  const browsing = intent !== "research" || !topic;

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
  const savedList = readSavedNiches(user.user_metadata);
  const [popular, allTop, related, saved, own, discovered, radarNiches, questions, evergreen] = await Promise.all([
    result ? Promise.resolve([]) : services.niches.popularTopics(8),
    result ? services.niches.topNiches(15) : Promise.resolve([]),
    result ? services.niches.relatedNiches(result.topic, result.report, 9) : Promise.resolve([]),
    result ? Promise.resolve([]) : services.niches.savedWithScores(savedList),
    // Only a report needs the creator's own numbers, for "how you'd fit".
    result ? ownChannel(user.id) : Promise.resolve(null),
    result || view.board !== "library" ? Promise.resolve([]) : services.niches.discover(view.format),
    // The radar tables arrive with a migration; until they exist these boards show their empty state.
    !result && browsing && view.board !== "library" ? services.radar.list({ limit: 400 }).catch(() => []) : Promise.resolve([]),
    !result && browsing && view.board === "ideas" ? services.radar.ideas({ limit: 30, days: 21, kind: "question", source: "reddit" }).catch(() => []) : Promise.resolve([]),
    !result && browsing && view.board === "ideas" ? services.radar.ideas({ limit: 30, days: 30, source: "stackexchange", orderBy: "views" }).catch(() => []) : Promise.resolve([]),
  ]);
  const discoverList = sortDiscovered(
    discovered.filter((n) => view.rpm === "all" || n.rpmTier === view.rpm),
    view.sort,
  ).slice(0, 24);
  // After a report, keep the exploring going: overlapping niches if we have them, otherwise the best ones we know.
  const topNiches = allTop.filter((idea) => idea.topicKey !== result?.topicKey).slice(0, 9);
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
          <TopicInput key={asked} defaultValue={asked} />
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
      {result ? null : <SavedNiches niches={saved} />}
      {result ? <Report result={result} drill={drill} saved={isSaved(savedList, result.topic)} own={own} /> : null}
      {related.length > 0 ? <IdeaBoard ideas={related} title={`Niches next to ${result!.topic}`} sub="Other researched topics that overlap with this one" /> : null}
      {result ? null : <DiscoverBoard niches={discoverList} gaps={sortGaps(radarNiches, view)} questions={questions} evergreen={evergreen} view={view} />}
      {result && topNiches.length > 0 ? (
        <IdeaBoard ideas={topNiches} title="Other underrated niches" sub="Mined from every channel Outlier tracks: real demand, room left, and small channels winning. Pick one to dig in." />
      ) : null}
    </div>
  );
}

/** The creator's channel over the last 30 days, or why there isn't one. */
async function ownChannel(userId: string): Promise<{ hasChannel: boolean; month: OwnChannelMonth | null }> {
  const services = getServices();
  try {
    const preferences = await services.onboarding.getPreferences(userId);
    const channel = preferences?.channel ?? null;
    return { hasChannel: channel !== null, month: channel ? await services.dashboard.ownChannelMonth(channel) : null };
  } catch {
    return { hasChannel: false, month: null };
  }
}

type Own = Awaited<ReturnType<typeof ownChannel>> | null;

function Fit({ metrics, own }: { metrics: NicheMetrics; own: Own }) {
  if (!own) return null;
  return <FitPanel fit={own.month ? nicheFit(metrics, own.month) : null} channelTitle={own.month?.title ?? null} hasChannel={own.hasChannel} />;
}

function Report({ result, drill, saved, own }: { result: NicheResult; drill: string; saved: boolean; own: Own }) {
  const { report } = result;
  const overall = report.overall;
  const sourceLabel = result.source === "youtube" ? "Fresh from YouTube" : result.source === "cache" ? "Saved report" : "From Outlier data";
  const top = report.subNiches.slice(0, 3);
  const rest = report.subNiches.slice(3);
  const earnings = estimateEarnings(overall.monthlyViews, result.topic);
  const focus = drill ? (report.subNiches.find((sub) => topicKey(sub.term) === topicKey(drill)) ?? null) : null;

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
      <div className="niche-actions">
        <SaveNicheButton topic={result.topic} score={overall.opportunity} saved={saved} />
        <CompareBox topic={result.topic} />
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
        <section className="niche-answer" aria-label={focus ? `${focus.term} in ${result.topic}` : `Top niches in ${result.topic}`}>
          {focus ? <SubNicheReport sub={focus} topic={result.topic} own={own} /> : null}
          {drill && !focus ? (
            <p className="dash-row-sub">
              &ldquo;{drill}&rdquo; isn&apos;t one of {result.topic}&apos;s niches any more — the report has been rebuilt since that link was made.
            </p>
          ) : null}
          {focus ? null : (
            <div className="niche-insights">
              <ScoreBreakdown metrics={overall} />
              <Fit metrics={overall} own={own} />
            </div>
          )}
          {focus ? null : <MoneyPanel earnings={earnings} title={`Money in ${result.topic}`} />}
          {focus ? null : <ViralChannels channels={overall.viralChannels ?? []} title={`Viral competitors in ${result.topic}`} />}

          <header className="niche-answer-head">
            <h2>
              {focus ? "Other niches in " : top.length > 0 ? `Top ${top.length} niche${top.length === 1 ? "" : "s"} in ` : ""}
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
              {(focus ? report.subNiches.filter((sub) => sub.term !== focus.term).slice(0, 3) : top).map((sub, i) => (
                <NicheCard
                  key={sub.term}
                  rank={i + 1}
                  name={sub.term}
                  href={`/research/niche-finder?topic=${encodeURIComponent(result.topic)}&sub=${encodeURIComponent(sub.term)}`}
                  score={sub.metrics.opportunity}
                  reason={reasonFor(sub.metrics)}
                  metrics={sub.metrics}
                  earnings={estimateEarnings(sub.metrics.monthlyViews, sub.term, result.topic)}
                  examples={sub.examples ?? breakoutExamples(sub.metrics)}
                  creators={sub.creators ?? []}
                />
              ))}
            </div>
          )}

          {focus ? null : (
            <>
              <TrendChart weekly={overall.weekly} />
              <Patterns patterns={overall.patterns} topic={result.topic} />
            </>
          )}

          {!focus && rest.length > 0 ? (
            <section className="niche-rest" aria-label={`More niches in ${result.topic}`}>
              <h3 className="dash-subhead">
                <CompassIcon size={14} /> {rest.length} more niche{rest.length === 1 ? "" : "s"} in {result.topic}
              </h3>
              <div className="niche-idea-grid">
                {rest.map((sub, i) => {
                  const money = estimateEarnings(sub.metrics.monthlyViews, sub.term, result.topic);
                  return (
                    <Link
                      key={sub.term}
                      href={`/research/niche-finder?topic=${encodeURIComponent(result.topic)}&sub=${encodeURIComponent(sub.term)}`}
                      className="dash-panel niche-idea"
                      style={{ "--i": i + 1 } as CSSProperties}
                    >
                      <header className="niche-idea-head">
                        <h3>{sub.term}</h3>
                        <span className="niche-score" data-band={band(sub.metrics.opportunity)}>
                          {sub.metrics.opportunity}
                        </span>
                      </header>
                      <p className="niche-idea-reason">{reasonFor(sub.metrics)}</p>
                      <IdeaTags demand={sub.metrics.demand} competition={sub.metrics.competition} format={sub.metrics.format.best} smallShare={sub.metrics.smallChannelShare} />
                      {money ? (
                        <p className="niche-idea-money">
                          <span>~{formatMoneyRange(money.typicalMonthly)}/mo typical</span>
                          <span>RPM {formatMoneyRange(money.blendedRpm)}</span>
                        </p>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </section>
          ) : null}

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

/**
 * One sub-niche, opened in full.
 *
 * This is what "Dig into X" shows. It reads out of the parent topic's report
 * rather than researching the term, because a sub-niche's name is only a label
 * for a slice of those videos — "escape" inside "steal a brainrot" is a group
 * of uploads, not a subject you can look up on its own.
 */
function SubNicheReport({ sub, topic, own }: { sub: SubNiche; topic: string; own: Own }) {
  const metrics = sub.metrics;
  const examples = sub.examples ?? breakoutExamples(metrics);
  const creators = sub.creators ?? [];

  return (
    <section className="niche-focus" aria-label={`${sub.term} in ${topic}`}>
      <Link href={`/research/niche-finder?topic=${encodeURIComponent(topic)}`} className="dash-link niche-focus-back">
        ← All niches in {topic}
      </Link>

      <header className="niche-focus-head">
        <div>
          <span className="dash-eyebrow">Inside {topic}</span>
          <h2>{sub.term}</h2>
          <p className="dash-row-sub">
            {reasonFor(metrics)} · {LEVEL_LABEL[metrics.confidence]} confidence
          </p>
        </div>
        <ScoreRing score={metrics.opportunity} label="Opportunity" />
      </header>

      <MetricGrid metrics={metrics} />
      <div className="niche-insights">
        <ScoreBreakdown metrics={metrics} />
        <Fit metrics={metrics} own={own} />
      </div>
      <TrendChart weekly={metrics.weekly} />
      <MoneyPanel earnings={estimateEarnings(metrics.monthlyViews, sub.term, topic)} title={`Money in ${sub.term}`} />
      <Patterns patterns={metrics.patterns} topic={sub.term} />
      <ViralChannels channels={metrics.viralChannels ?? []} title={`Viral competitors in ${sub.term}`} />

      <h3 className="dash-subhead">
        <FlameIcon size={14} /> Uploads in this niche
      </h3>
      {examples.length === 0 ? (
        <p className="dash-row-sub">No example videos stored yet. They appear once this topic is refreshed from YouTube.</p>
      ) : (
        <div className="niche-examples niche-focus-examples">
          {examples.slice(0, 12).map((example) => (
            <ExampleVideo key={example.youtubeVideoId} example={example} />
          ))}
        </div>
      )}

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

      <Lists metrics={metrics} />
    </section>
  );
}

/** The report carries a wider pool so the script writer can filter it; a page shows the top few. */
const BREAKOUTS_SHOWN = 5;

/** Older cached reports have breakouts but no examples. */
function breakoutExamples(metrics: NicheMetrics): NicheExample[] {
  return metrics.breakouts.slice(0, BREAKOUTS_SHOWN).map((b) => ({
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
              href={`/research/niche-finder?topic=${encodeURIComponent(idea.topic)}`}
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
 * One niche answer: why it's worth it and one example that proves it, followed by
 * the rest of the examples, the small creators behind them, and the numbers
 * (shown by default, collapsible).
 */
function NicheCard({
  rank,
  name,
  href,
  score,
  reason,
  examples,
  creators,
  metrics,
  tags,
  earnings,
}: {
  rank: number;
  name: string;
  /** Where "Dig into" goes. A sub-niche drills into its parent's report; a topic researches itself. */
  href: string;
  score: number;
  reason: string;
  examples: NicheExample[];
  creators: NicheCreator[];
  metrics?: NicheMetrics;
  tags?: TagValues;
  earnings?: NicheEarnings | null;
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

      {earnings ? (
        <dl className="niche-money-strip">
          <div>
            <dt>RPM</dt>
            <dd>{formatMoneyRange(earnings.blendedRpm)}</dd>
          </div>
          <div>
            <dt>Typical channel</dt>
            <dd>~{formatMoneyRange(earnings.typicalMonthly)}/mo</dd>
          </div>
          <div>
            <dt>Top channel</dt>
            <dd>~{formatMoneyRange(earnings.topMonthly)}/mo</dd>
          </div>
        </dl>
      ) : null}

      {lead ? <ExampleVideo example={lead} featured /> : <p className="dash-row-sub">No example videos stored yet.</p>}

      <details className="niche-more" open>
        <summary>
          <span className="niche-more-hide">Hide details</span>
          <span className="niche-more-show">Show details</span>
        </summary>
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
          <Link href={href} className="dash-link">
            Dig into {name}
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

/** What a channel here might earn: RPM for its category and format mix, times the views channels actually get. */
function MoneyPanel({ earnings, title }: { earnings: NicheEarnings | null; title: string }) {
  if (!earnings) return null;
  const items = [
    {
      label: "Est. RPM",
      value: formatMoneyRange(earnings.blendedRpm),
      hint: `Long-form ${formatMoneyRange(earnings.rpm.long)} · Shorts ${formatMoneyRange(earnings.rpm.shorts)} per 1K views`,
    },
    { label: "Typical channel / month", value: `~${formatMoneyRange(earnings.typicalMonthly)}`, hint: `${formatCompact(earnings.monthlyViews.typical)} views a month` },
    { label: "Top channel / month", value: `~${formatMoneyRange(earnings.topMonthly)}`, hint: `${formatCompact(earnings.monthlyViews.top)} views a month` },
  ];
  return (
    <section className="niche-money" aria-label={title}>
      <header>
        <h3 className="dash-subhead">{title}</h3>
        {earnings.category ? <span className="niche-money-cat">{earnings.category}</span> : null}
      </header>
      <dl>
        {items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
            <span>{item.hint}</span>
          </div>
        ))}
      </dl>
      <p className="niche-money-note">
        Estimates from typical {earnings.category ?? "YouTube"} RPMs and the views channels here got in the last 30 days. Real earnings depend on audience
        country, season and how many views are monetized.
      </p>
    </section>
  );
}

/** Channels here that go viral most often, with the upload that went furthest. */
function ViralChannels({ channels, title }: { channels: ViralChannel[]; title: string }) {
  if (channels.length === 0) return null;
  return (
    <section className="niche-viral" aria-label={title}>
      <h3 className="dash-subhead">
        <FlameIcon size={14} /> {title}
      </h3>
      <div className="niche-viral-grid">
        {channels.map((c, i) => (
          <a
            key={c.youtube_channel_id}
            href={c.best.format === "short" ? `https://www.youtube.com/shorts/${c.best.youtube_video_id}` : `https://www.youtube.com/watch?v=${c.best.youtube_video_id}`}
            target="_blank"
            rel="noreferrer"
            className="niche-viral-card"
            style={{ "--i": i + 1 } as CSSProperties}
          >
            <span className="niche-viral-head">
              {c.thumbnail_url ? <img src={c.thumbnail_url} alt="" loading="lazy" /> : <span className="niche-creator-blank" />}
              <span className="niche-viral-name">
                <strong>{c.title}</strong>
                <em>{c.subscriber_count !== null ? `${formatCompact(c.subscriber_count)} subs` : "Hidden subs"}</em>
              </span>
              <span className="dash-mult">{c.bestMultiplier}×</span>
            </span>
            <span className="niche-viral-best">{c.best.title}</span>
            <span className="niche-viral-meta">
              {c.viralUploads} viral upload{c.viralUploads === 1 ? "" : "s"} · best {formatCompact(c.best.view_count)} views
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}

function discoverHref(view: View, change: Partial<View>) {
  const next = { ...view, ...change };
  return `/research/niche-finder?board=${next.board}&format=${next.format}&rpm=${next.rpm}&sort=${next.sort}`;
}

const RPM_TIER_LABEL = { high: "High RPM", mid: "Mid RPM", low: "Low RPM" } as const;

const GAP_SORT: Record<DiscoverSort, (n: RadarNiche) => number> = {
  best: (n) => n.score,
  rpm: (n) => n.parts.pay * 10 + n.score / 100,
  views: (n) => n.parts.demand * 10 + n.score / 100,
  untapped: (n) => n.parts.gap * 10 + n.score / 100,
  easy: (n) => n.parts.ease * 10 + n.score / 100,
};

/** Radar phrases for the chosen format and RPM, in the chosen order. */
function sortGaps(niches: readonly RadarNiche[], view: View): RadarNiche[] {
  return niches
    .filter((n) => n.format === view.format && (view.rpm === "all" || rpmTierOf(n.rpm, n.format) === view.rpm))
    .sort((a, b) => GAP_SORT[view.sort](b) - GAP_SORT[view.sort](a))
    .slice(0, 24);
}

const BOARD_SUB: Record<Board, string> = {
  library: "No search needed. Every niche in the channels Outlier tracks, scored on RPM, views, how untapped it is and how easy it is to make.",
  gaps: "What people type into YouTube search where the results are old, small channels are winning and no giant owns the page. Checked around the clock.",
  ideas: "First videos to make in the most open niches, questions read hundreds of thousands of times on Stack Exchange, and what Reddit is asking this week.",
};

/**
 * The browse view: niches found without a search, ranked on what pays, what
 * gets watched, what's untapped and what's easy to make. Three sources: the
 * channel library, the search radar, and the ideas both turn up.
 */
function DiscoverBoard({
  niches,
  gaps,
  questions,
  evergreen,
  view,
}: {
  niches: DiscoveredNiche[];
  gaps: RadarNiche[];
  questions: NicheIdeaRow[];
  evergreen: NicheIdeaRow[];
  view: View;
}) {
  return (
    <section className="niche-ideas" aria-label="Discover niches">
      <h2 className="dash-subhead">
        <CompassIcon size={14} /> Discover niches
      </h2>
      <p className="dash-row-sub niche-ideas-sub">{BOARD_SUB[view.board]}</p>
      <nav className="discover-tabs" aria-label="Where the niches come from">
        {BOARDS.map((b) => (
          <Link key={b.value} href={discoverHref(view, { board: b.value })} aria-current={view.board === b.value ? "page" : undefined}>
            {b.label}
          </Link>
        ))}
      </nav>
      <Filters view={view} />
      {view.board === "gaps" ? (
        <GapBoard gaps={gaps} />
      ) : view.board === "ideas" ? (
        <IdeasBoard gaps={gaps} questions={questions} evergreen={evergreen} />
      ) : (
        <LibraryBoard niches={niches} view={view} />
      )}
      <p className="dash-row-sub">RPM is an estimate by category from public creator reports; real RPM depends on audience country and season.</p>
    </section>
  );
}

function Filters({ view }: { view: View }) {
  return (
    <div className="discover-filters">
      <div className="dash-topics" role="group" aria-label="Format">
        {(["shorts", "long_form"] as const).map((f) => (
          <Link key={f} href={discoverHref(view, { format: f })} className="dash-topic" data-mine={view.format === f}>
            {f === "shorts" ? "Shorts" : "Long-form"}
          </Link>
        ))}
      </div>
      <div className="dash-topics" role="group" aria-label="RPM">
        {RPM_FILTERS.map((f) => (
          <Link key={f.value} href={discoverHref(view, { rpm: f.value })} className="dash-topic" data-mine={view.rpm === f.value}>
            {f.label}
          </Link>
        ))}
      </div>
      <div className="dash-topics" role="group" aria-label="Sort">
        {SORTS.map((s) => (
          <Link key={s.value} href={discoverHref(view, { sort: s.value })} className="dash-topic" data-mine={view.sort === s.value}>
            {s.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function LibraryBoard({ niches, view }: { niches: DiscoveredNiche[]; view: View }) {
  if (niches.length === 0) {
    return (
      <div className="dash-empty">
        <strong>Nothing clears the bar with these filters yet</strong>
        <p>
          The list grows as more channels are tracked. Meanwhile, <Link href={discoverHref(view, { board: "gaps" })}>search gaps</Link> covers niches
          nobody tracks yet.
        </p>
      </div>
    );
  }
  return (
    <div className="niche-idea-grid">
      {niches.map((n, i) => (
        <Link
          key={n.term}
          href={`/research/niche-finder?topic=${encodeURIComponent(n.term)}`}
          className="dash-panel niche-idea discover-card"
          style={{ "--i": i + 1 } as CSSProperties}
        >
          <header className="niche-idea-head">
            <h3>{n.term}</h3>
            <span className="niche-score" data-band={band(n.total)}>
              {n.total}
            </span>
          </header>
          <p className="niche-idea-reason">{n.reason}</p>
          <dl className="discover-scores">
            <div><dt>RPM</dt><dd>{formatMoneyRange(n.rpm)}</dd></div>
            <div><dt>Per 1M views</dt><dd>~{formatMoney(n.perMillion)}</dd></div>
            <div><dt>Views/day</dt><dd>{formatCompact(Math.round(n.metrics.medianViewsPerDay))}</dd></div>
          </dl>
          <div className="discover-bars">
            {(["rpm", "views", "untapped", "easy"] as const).map((k) => (
              <div key={k} className="discover-bar">
                <span>{k === "rpm" ? "RPM" : k === "easy" ? "Easy" : k === "views" ? "Views" : "Untapped"}</span>
                <i style={{ "--w": `${n.scores[k]}%` } as CSSProperties} />
              </div>
            ))}
          </div>
          <div className="niche-idea-tags">
            <span>{RPM_TIER_LABEL[n.rpmTier]}</span>
            <span>{formatPercent(n.smallChannelViewShare, 0)} views to small channels</span>
            <span>{n.easeNote}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

function RadarEmpty() {
  return (
    <div className="dash-empty">
      <strong>Nothing here yet with these filters</strong>
      <p>The radar checks search phrases a few hundred at a time, all day. Try another format or RPM level, or come back later.</p>
    </div>
  );
}

/** Why a search phrase looks open, in one line. */
function gapReason(n: RadarNiche): string {
  const s = n.supply;
  const bits: string[] = [];
  if (s.recentShare <= 0.2) bits.push(`${formatPercent(1 - s.recentShare, 0)} of results are over 3 months old`);
  if (s.smallWins > 0) bits.push(`${s.smallWins} small channel${s.smallWins === 1 ? "" : "s"} breaking out`);
  if (s.bigShare <= 0.1) bits.push("no giant channels ranking");
  if (bits.length === 0) bits.push(`results get a median ${formatCompact(s.medianViews)} views`);
  return bits.join(" · ");
}

const GAP_PART_LABEL = { demand: "Demand", pay: "Pay", gap: "Open", ease: "Easy" } as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function GapBoard({ gaps }: { gaps: RadarNiche[] }) {
  if (gaps.length === 0) return <RadarEmpty />;
  return (
    <div className="niche-idea-grid">
      {gaps.map((n, i) => {
        const proof = n.supply.top[0];
        return (
          <article key={n.keyword} className="dash-panel niche-idea discover-card" style={{ "--i": i + 1 } as CSSProperties}>
            <header className="niche-idea-head">
              <h3>
                <Link href={`/research/niche-finder?topic=${encodeURIComponent(n.keyword)}`}>{n.keyword}</Link>
              </h3>
              <span className="niche-score" data-band={band(n.score)}>
                {n.score}
              </span>
            </header>
            <p className="niche-idea-reason">{gapReason(n)}</p>
            <dl className="discover-scores">
              {n.demand?.volume != null ? (
                <div><dt>Searches/mo</dt><dd>{formatCompact(n.demand.volume)}</dd></div>
              ) : (
                <div><dt>Median views</dt><dd>{formatCompact(n.supply.medianViews)}</dd></div>
              )}
              {n.demand?.cpc ? (
                <div><dt>Ad CPC</dt><dd>{formatMoney(n.demand.cpc)}</dd></div>
              ) : (
                <div><dt>RPM</dt><dd>{formatMoneyRange(n.rpm)}</dd></div>
              )}
              <div><dt>Results age</dt><dd>{Math.round(n.supply.medianAgeDays)}d</dd></div>
            </dl>
            <div className="discover-bars">
              {(["demand", "pay", "gap", "ease"] as const).map((k) => (
                <div key={k} className="discover-bar">
                  <span>{GAP_PART_LABEL[k]}</span>
                  <i style={{ "--w": `${n.parts[k]}%` } as CSSProperties} />
                </div>
              ))}
            </div>
            {n.ease?.how ? <p className="dash-row-sub">{n.ease.how}</p> : null}
            <div className="niche-idea-tags">
              {n.source === "rising" ? <span data-tone="new">New in search</span> : null}
              {n.category ? <span>{n.category}</span> : null}
              {n.ease?.faceless ? <span>Faceless</span> : null}
              {n.ease?.production.slice(0, 2).map((p) => <span key={p}>{p}</span>)}
              {n.demand?.trend != null && n.demand.trend > 0.15 ? <span>Searches rising</span> : null}
              {n.demand?.peakMonth ? <span>Peaks in {MONTHS[n.demand.peakMonth - 1]}</span> : null}
            </div>
            {proof ? (
              <a className="gap-proof" href={`https://www.youtube.com/watch?v=${proof.id}`} target="_blank" rel="noreferrer">
                <span>Proof</span> {proof.title} · {formatCompact(proof.views)} views
                {proof.subscribers != null ? ` on ${formatCompact(proof.subscribers)} subs` : ""}
              </a>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function IdeasBoard({ gaps, questions, evergreen }: { gaps: RadarNiche[]; questions: NicheIdeaRow[]; evergreen: NicheIdeaRow[] }) {
  const withIdeas = gaps.filter((n) => (n.ease?.ideas.length ?? 0) > 0).slice(0, 12);
  if (withIdeas.length === 0 && questions.length === 0 && evergreen.length === 0) return <RadarEmpty />;
  return (
    <div className="ideas-columns">
      {withIdeas.length > 0 ? (
        <div className="dash-panel ideas-list">
          <h3>First videos to make</h3>
          <ul>
            {withIdeas.map((n) => (
              <li key={n.keyword}>
                <Link href={`/research/niche-finder?topic=${encodeURIComponent(n.keyword)}`} className="ideas-niche">
                  {n.keyword}
                  <span className="niche-score" data-band={band(n.score)}>
                    {n.score}
                  </span>
                </Link>
                <ol>
                  {n.ease!.ideas.map((idea) => (
                    <li key={idea}>{idea}</li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {evergreen.length > 0 ? (
        <div className="dash-panel ideas-list">
          <h3>Questions people search for</h3>
          <ul>
            {evergreen.map((q) => (
              <li key={q.id}>
                <a href={q.url} target="_blank" rel="noreferrer">
                  {q.title}
                </a>
                <span className="dash-row-sub">
                  {q.views != null ? `${formatCompact(q.views)} views · ` : ""}
                  {q.community ?? "Stack Exchange"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {questions.length > 0 ? (
        <div className="dash-panel ideas-list">
          <h3>Asked on Reddit this week</h3>
          <ul>
            {questions.map((q) => (
              <li key={q.id}>
                <a href={q.url} target="_blank" rel="noreferrer">
                  {q.title}
                </a>
                <span className="dash-row-sub">
                  {q.community ? `r/${q.community} · ` : ""}
                  {formatCompact(q.score)} upvotes · {formatCompact(q.comments)} comments
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
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
            {metrics.breakouts.slice(0, BREAKOUTS_SHOWN).map((v) => (
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
