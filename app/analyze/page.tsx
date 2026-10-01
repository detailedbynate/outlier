/* eslint-disable @next/next/no-img-element -- YouTube images are already CDN-optimized */
import { ChartIcon } from "@/components/icons";
import { LineChart } from "@/components/line-chart";
import { PageHeader } from "@/components/page-header";
import { WEEKDAYS, type TitleTraitKey } from "@/lib/analytics/video-insights";
import { isAppError } from "@/lib/core/errors";
import { formatCompact, formatDuration, formatMultiplier, formatNumber, formatPercent, timeAgo } from "@/lib/format";
import { requireApprovedUser } from "@/lib/auth/session";
import { Paywall } from "@/components/paywall";
import { paidFeaturesLocked } from "@/lib/billing/feature-gate";
import { PAID_FEATURES } from "@/lib/billing/features";
import { getServices } from "@/lib/services";
import { parseVideoId } from "@/lib/youtube/parse";
import { asUser } from "@/lib/youtube/quota-context";
import type { VideoAnalysis } from "@/lib/services/video-service";
import type { YouTubeVideo } from "@/types/youtube";

export const dynamic = "force-dynamic";
// A transcript read can take a few seconds on top of the YouTube calls.
export const maxDuration = 30;

export default async function AnalyzePage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const current = await requireApprovedUser();
  const { user } = current;
  // Free is Shorts Channels only: show the paywall before loading anything.
  if (await paidFeaturesLocked(current)) return <Paywall feature={PAID_FEATURES["analyze"]} />;
  const { v } = await searchParams;
  const input = v?.trim() ?? "";

  let analysis: VideoAnalysis | null = null;
  let error: string | null = null;
  if (input) {
    const { credits, videos } = getServices();
    try {
      const videoId = parseVideoId(input);
      if (!(await credits.alreadyPaid(user.id, "analyze_video", videoId))) await credits.assertAvailable(user.id, "analyze_video");
      analysis = await asUser(user.id, "page:analyze_video", () => videos.analyzeVideo(videoId));
      // Re-opening the same video today is free.
      await credits.charge(user.id, "analyze_video", videoId);
    } catch (e) {
      error = isAppError(e) && e.expose ? e.message : "Could not analyze that video.";
    }
  }

  return (
    <div className="stack dash az">
      <PageHeader icon={ChartIcon} title="Analyze Video" subtitle="Paste any YouTube video or Short to see how it did against its own channel, and what stands out · 2 credits" />

      <form className="card" method="get">
        <div className="form">
          <label htmlFor="v" className="sr-only">
            Video URL or ID
          </label>
          <input id="v" name="v" type="text" defaultValue={input} placeholder="https://www.youtube.com/watch?v=…" required />
          <button type="submit">Analyze</button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </form>

      {analysis ? <AnalysisResult analysis={analysis} /> : null}
    </div>
  );
}

function verdictFor(score: number | null): { band: "high" | "mid" | "low" | "none"; text: string } {
  if (score === null) return { band: "none", text: "Not enough channel history to compare." };
  if (score >= 3) return { band: "high", text: "Breakout: far above this channel's normal." };
  if (score >= 1.5) return { band: "high", text: "Above average for this channel." };
  if (score >= 0.7) return { band: "mid", text: "About normal for this channel." };
  return { band: "low", text: "Below this channel's usual." };
}

function AnalysisResult({ analysis }: { analysis: VideoAnalysis }) {
  const { video, channel, metrics, insights } = analysis;
  const kind = video.format === "short" ? "Shorts" : "videos";
  const verdict = verdictFor(metrics.outlierScore);
  const watchUrl = video.format === "short" ? `https://www.youtube.com/shorts/${video.id}` : `https://www.youtube.com/watch?v=${video.id}`;

  return (
    <>
      <section className="dash-panel az-hero">
        {video.thumbnailUrl ? (
          <a href={watchUrl} target="_blank" rel="noreferrer" className="az-thumb" data-format={video.format}>
            <img src={video.thumbnailUrl} alt="" />
          </a>
        ) : null}
        <div className="az-hero-main">
          <h2>
            <a href={watchUrl} target="_blank" rel="noreferrer">
              {video.title}
            </a>
          </h2>
          <div className="az-meta">
            <a href={`https://www.youtube.com/channel/${channel.id}`} target="_blank" rel="noreferrer">
              {channel.title}
            </a>
            <span>{formatCompact(channel.statistics.subscriberCount)} subs</span>
            <span>{timeAgo(video.publishedAt)}</span>
            {video.durationSeconds ? <span>{formatDuration(video.durationSeconds)}</span> : null}
            <span className="badge">{video.format === "short" ? "Short" : "Video"}</span>
          </div>
          <div className="az-verdict" data-band={verdict.band}>
            <span className="az-verdict-score">{formatMultiplier(metrics.outlierScore)}</span>
            <span className="az-verdict-text">
              <strong>{verdict.text}</strong>
              <span>
                vs the channel&apos;s typical {video.format === "short" ? "Short" : "video"} ({formatCompact(metrics.channelMedianViews)} views)
                {insights.rank ? ` · #${insights.rank.position} of its last ${insights.rank.of} ${kind}` : ""}
              </span>
            </span>
          </div>
        </div>
      </section>

      <div className="home-tiles az-tiles">
        <Tile label="Views" value={formatCompact(video.statistics.viewCount)} note={metrics.viewsDelta24h ? `+${formatCompact(metrics.viewsDelta24h)} in the last day` : formatNumber(video.statistics.viewCount)} tone="violet" />
        <Tile
          label="Views a day"
          value={formatCompact(metrics.viewsPerDay)}
          note={insights.channel.medianViewsPerDay ? `channel's usual ${formatCompact(insights.channel.medianViewsPerDay)}` : "since upload"}
          tone="blue"
        />
        <Tile
          label="Reach"
          value={insights.viewsPerSubscriber === null ? "—" : `${insights.viewsPerSubscriber >= 10 ? Math.round(insights.viewsPerSubscriber) : insights.viewsPerSubscriber.toFixed(1)}×`}
          note="views per subscriber"
          tone="pink"
        />
        <Tile
          label="Like rate"
          value={formatPercent(insights.likeRate, 1)}
          note={insights.channel.likeRate !== null ? `channel's usual ${formatPercent(insights.channel.likeRate, 1)}` : `${formatCompact(video.statistics.likeCount)} likes`}
          tone="green"
        />
        <Tile
          label="Comments"
          value={formatCompact(video.statistics.commentCount)}
          note={
            insights.commentRate !== null && insights.channel.commentRate
              ? `${(insights.commentRate / insights.channel.commentRate).toFixed(1)}× the channel's usual rate`
              : "comments on the video"
          }
          tone="amber"
        />
      </div>

      {analysis.peers.length >= 3 ? <PeersChart video={video} peers={analysis.peers} median={metrics.channelMedianViews} kind={kind} /> : null}

      {insights.highlights.length > 0 ? (
        <section className="dash-panel az-highlights" aria-label="What stands out">
          <header className="dash-panel-head">
            <div className="dash-panel-titles">
              <h2>What stands out</h2>
              <p>
                Compared with the channel&apos;s {analysis.peers.length} other recent {kind}
              </p>
            </div>
          </header>
          <ul>
            {insights.highlights.map((h) => (
              <li key={h.text} data-tone={h.tone}>
                {h.text}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="az-cols" data-single={analysis.hook ? undefined : ""}>
        <Packaging analysis={analysis} />
        {/* Only when there's something to show: most videos have no transcript on file yet. */}
        {analysis.hook ? <Hook analysis={analysis} /> : null}
      </div>

      {analysis.history.length >= 3 ? (
        <section className="dash-panel" aria-label="Views over time">
          <header className="dash-panel-head">
            <div className="dash-panel-titles">
              <h2>Views over time</h2>
              <p>From Outlier&apos;s daily checks on this video</p>
            </div>
          </header>
          <LineChart points={analysis.history.map((h) => ({ t: h.t, value: h.views }))} label="Views" />
        </section>
      ) : null}
    </>
  );
}

function Tile({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return (
    <div className="dash-stat home-tile" data-tone={tone}>
      <span className="dash-stat-label">{label}</span>
      <span className="dash-stat-value">{value}</span>
      <span className="dash-stat-note" title={note}>
        {note}
      </span>
    </div>
  );
}

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** This video among the channel's recent uploads, oldest to newest. Same look as the dashboard's uploads chart. */
function PeersChart({ video, peers, median, kind }: { video: YouTubeVideo; peers: YouTubeVideo[]; median: number | null; kind: string }) {
  const bars = [...peers, video].sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt)).slice(-24);
  // One huge breakout would flatten every other bar to nothing. When the top bar
  // dwarfs the rest, scale to the runner-up and draw the top one cut off.
  const sorted = bars.map((v) => v.statistics.viewCount).sort((a, b) => b - a);
  const [top = 0, second = 0] = sorted;
  const broken = second > 0 && top > second * 3;
  const max = Math.max(broken ? second * 1.2 : top, median ?? 0, 1);
  const pct = (n: number) => `${Math.min(Math.max((n / max) * 100, 1.5), 100)}%`;
  const crowded = bars.length > 14;

  return (
    <section className="dash-panel az-chart" aria-label={`This video among the channel's recent ${kind}`}>
      <header className="dash-panel-head">
        <div className="dash-panel-titles">
          <h2>Against the channel&apos;s recent {kind}</h2>
          <p>
            Views on each upload, this one highlighted · hover a bar for the title
            {broken ? " · the tallest bar is cut off so the rest stay readable" : ""}
          </p>
        </div>
        {median ? (
          <div className="dash-panel-action home-legend">
            <span data-key="bar">Views</span>
            <span data-key="median">Typical · {formatCompact(median)}</span>
          </div>
        ) : null}
      </header>
      <div className="home-bars">
        <div className="home-gridlines" aria-hidden="true">
          <span data-label={formatCompact(max)} />
          <span data-label={formatCompact(max / 2)} />
          <span data-label="0" />
        </div>
        {median ? (
          <span className="home-median-plot" aria-hidden="true">
            <span className="home-median" style={{ bottom: pct(median) }} />
          </span>
        ) : null}
        {bars.map((v, i) => {
          const self = v.id === video.id;
          return (
            <a
              key={v.id}
              href={v.format === "short" ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`}
              target="_blank"
              rel="noreferrer"
              className="home-bar"
              data-best={self || undefined}
              data-above={!self && median !== null && v.statistics.viewCount >= median ? "" : undefined}
              data-edge={i < 2 ? "start" : i >= bars.length - 2 ? "end" : undefined}
              data-broken={broken && v.statistics.viewCount > max ? "" : undefined}
              data-quiet-label={crowded && i % 2 === 1 && !self ? "" : undefined}
              aria-label={`${v.title}: ${formatCompact(v.statistics.viewCount)} views`}
            >
              <span className="home-bar-fill" style={{ height: pct(v.statistics.viewCount) }}>
                {self ? <span className="home-bar-flag">This one · {formatCompact(v.statistics.viewCount)}</span> : null}
              </span>
              <span className="home-bar-tip">
                <strong>{v.title}</strong>
                {formatCompact(v.statistics.viewCount)} views
              </span>
              <span className="home-bar-label">{shortDate.format(new Date(v.publishedAt))}</span>
            </a>
          );
        })}
      </div>
    </section>
  );
}

const TRAIT_LABEL: Record<TitleTraitKey, string> = {
  number: "Number",
  question: "Question",
  caps: "CAPS word",
  you: '"You"',
  emoji: "Emoji",
};

function Packaging({ analysis }: { analysis: VideoAnalysis }) {
  const { video, insights } = analysis;
  const { channel, title, posted, hashtags } = insights;
  const rows: { label: string; value: string; usual: string | null }[] = [
    { label: "Title length", value: `${title.words} words`, usual: channel.titleWords !== null ? `${channel.titleWords} words` : null },
    {
      label: "Length",
      value: video.durationSeconds ? formatDuration(video.durationSeconds) : "—",
      usual: channel.durationSeconds ? formatDuration(Math.round(channel.durationSeconds)) : null,
    },
    {
      label: "Posted",
      value: `${WEEKDAYS[posted.weekday]} ${String(posted.hourUtc).padStart(2, "0")}:00 UTC`,
      usual: posted.channelTopWeekday !== null ? `mostly ${WEEKDAYS[posted.channelTopWeekday]}s` : null,
    },
    { label: "Upload pace", value: channel.uploadsPerWeek !== null ? `${channel.uploadsPerWeek} a week` : "—", usual: null },
  ];

  return (
    <section className="dash-panel az-packaging" aria-label="Packaging">
      <header className="dash-panel-head">
        <div className="dash-panel-titles">
          <h2>Packaging</h2>
          <p>This video next to the channel&apos;s usual</p>
        </div>
      </header>
      <dl className="az-rows">
        {rows.map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd>
              {r.value}
              {r.usual ? <em>usual {r.usual}</em> : null}
            </dd>
          </div>
        ))}
      </dl>
      <div className="az-traits">
        {title.traits.map((t) => (
          <span key={t.key} className="az-trait" data-has={t.has || undefined} title={t.channelShare !== null ? `${Math.round(t.channelShare * 100)}% of the channel's recent titles` : undefined}>
            {t.has ? "✓" : "–"} {TRAIT_LABEL[t.key]}
            {t.channelShare !== null ? <em>{Math.round(t.channelShare * 100)}%</em> : null}
          </span>
        ))}
      </div>
      <p className="az-note">Ticks are what this title uses; the percentage is how many of the channel&apos;s recent titles do.</p>
      {hashtags.length > 0 ? (
        <div className="az-hashtags">
          {hashtags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      ) : null}
      {video.tags.length > 0 ? <p className="az-note">{video.tags.length} tags: {video.tags.slice(0, 8).join(", ")}{video.tags.length > 8 ? "…" : ""}</p> : null}
    </section>
  );
}

function Hook({ analysis }: { analysis: VideoAnalysis }) {
  const hook = analysis.hook;
  if (!hook) return null;
  return (
    <section className="dash-panel az-hook" aria-label="The hook">
      <header className="dash-panel-head">
        <div className="dash-panel-titles">
          <h2>The hook</h2>
          <p>What it says in the first 3 seconds</p>
        </div>
      </header>
      <blockquote>&ldquo;{hook.opening}&rdquo;</blockquote>
      <dl className="az-rows">
        <div>
          <dt>Spoken words</dt>
          <dd>{formatNumber(hook.words)}</dd>
        </div>
        {hook.wordsPerSecond !== null ? (
          <div>
            <dt>Pace</dt>
            <dd>
              {hook.wordsPerSecond} words a second
              <em>{hook.wordsPerSecond >= 3 ? "fast" : hook.wordsPerSecond >= 2.2 ? "normal" : "slow"}</em>
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
