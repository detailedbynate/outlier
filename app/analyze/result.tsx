/* eslint-disable @next/next/no-img-element -- YouTube images are already CDN-optimized */
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import {
  CalendarIcon,
  ClockIcon,
  ExternalIcon,
  EyeIcon,
  FlameIcon,
  InfoIcon,
  MessageIcon,
  PenIcon,
  TargetIcon,
  ThumbsUpIcon,
  TrendingDownIcon,
  TrendingIcon,
  UsersIcon,
  ZapIcon,
} from "@/components/icons";
import { LineChart } from "@/components/line-chart";
import { videoBreakdown, type BreakdownMeasure, type GroupStat, type VideoBreakdown } from "@/lib/analytics/video-breakdown";
import { WEEKDAYS, type TitleTraitKey } from "@/lib/analytics/video-insights";
import { formatCompact, formatDuration, formatMultiplier, formatNumber, formatPercent, timeAgo } from "@/lib/format";
import type { VideoAnalysis } from "@/lib/services/video-service";
import type { YouTubeVideo } from "@/types/youtube";

type Tone = "hot" | "up" | "flat" | "down";

/** How a value sits against the channel's usual, in words and a colour. */
function standing(ratio: number | null): { tone: Tone; text: string } | null {
  if (ratio === null) return null;
  if (ratio >= 1.5) return { tone: "hot", text: "Well above usual" };
  if (ratio >= 1.1) return { tone: "up", text: "Above usual" };
  if (ratio >= 0.9) return { tone: "flat", text: "About usual" };
  if (ratio >= 0.6) return { tone: "down", text: "Below usual" };
  return { tone: "down", text: "Well below usual" };
}

function verdictFor(score: number | null): { tone: Tone | "none"; title: string } {
  if (score === null) return { tone: "none", title: "Not enough channel history to compare" };
  if (score >= 3) return { tone: "hot", title: "Breakout" };
  if (score >= 1.5) return { tone: "hot", title: "Above average" };
  if (score >= 1.1) return { tone: "up", title: "A little above average" };
  if (score >= 0.7) return { tone: "flat", title: "About normal" };
  return { tone: "down", title: "Below its usual" };
}

const watchUrl = (v: YouTubeVideo) => (v.format === "short" ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`);
const ratioText = (r: number | null) => (r === null ? "—" : `${r >= 10 ? Math.round(r) : r.toFixed(1)}×`);

export function AnalysisResult({ analysis }: { analysis: VideoAnalysis }) {
  const { video, metrics, insights } = analysis;
  const breakdown = videoBreakdown(
    {
      video,
      peers: analysis.peers,
      insights,
      medianViews: metrics.channelMedianViews,
      viewsPerDay: metrics.viewsPerDay,
      growth: { last24h: metrics.viewsDelta24h, last7d: metrics.viewsDelta7d },
    },
    new Date(analysis.analyzedAt),
  );
  const kind = video.format === "short" ? "Shorts" : "videos";
  const hasSide = Boolean(analysis.hook) || analysis.history.length >= 3 || breakdown.momentum !== null;

  return (
    <>
      <Hero analysis={analysis} breakdown={breakdown} />
      <Kpis analysis={analysis} />

      <div className="av-grid" data-cols="wide">
        <Measures measures={breakdown.measures} kind={kind} />
        <Standing analysis={analysis} breakdown={breakdown} kind={kind} />
      </div>

      {analysis.peers.length >= 3 ? <PeersChart video={video} peers={analysis.peers} median={metrics.channelMedianViews} kind={kind} /> : null}

      {insights.highlights.length > 0 ? <Highlights analysis={analysis} kind={kind} /> : null}

      {breakdown.weekdays || breakdown.lengths ? (
        <div className="av-grid" data-single={breakdown.weekdays && breakdown.lengths ? undefined : ""}>
          {breakdown.weekdays ? (
            <GroupChart
              title="Best day to post"
              note="Median views by upload day (UTC)"
              icon={<CalendarIcon size={15} />}
              groups={breakdown.weekdays.days}
              best={breakdown.weekdays.best}
              kind={kind}
            />
          ) : null}
          {breakdown.lengths ? (
            <GroupChart
              title="Best length"
              note={`Median views by how long the ${kind} run`}
              icon={<ClockIcon size={15} />}
              groups={breakdown.lengths.buckets}
              best={breakdown.lengths.best}
              kind={kind}
            />
          ) : null}
        </div>
      ) : null}

      <div className="av-grid" data-single={hasSide ? undefined : ""}>
        <Packaging analysis={analysis} breakdown={breakdown} />
        {hasSide ? (
          <div className="av-col">
            {analysis.hook ? <Hook hook={analysis.hook} /> : null}
            {breakdown.momentum || analysis.history.length >= 3 ? <Momentum analysis={analysis} breakdown={breakdown} /> : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

function PanelHead({ title, note, icon, action }: { title: string; note?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <header className="dash-panel-head av-head">
      <div className="dash-panel-titles">
        {icon ? <span className="av-head-icon">{icon}</span> : null}
        <h2>{title}</h2>
        {note ? <p>{note}</p> : null}
      </div>
      {action ? <div className="dash-panel-action">{action}</div> : null}
    </header>
  );
}

/** The video, who made it, and the verdict on a ring: how much of the channel's recent uploads it beat. */
function Hero({ analysis, breakdown }: { analysis: VideoAnalysis; breakdown: VideoBreakdown }) {
  const { video, channel, metrics } = analysis;
  const verdict = verdictFor(metrics.outlierScore);
  const label = video.format === "short" ? "Short" : "video";
  const pct = breakdown.percentile;
  const R = 54;
  const C = 2 * Math.PI * R;

  return (
    <section className="dash-panel av-hero" data-format={video.format}>
      {video.thumbnailUrl ? (
        <a href={watchUrl(video)} target="_blank" rel="noreferrer" className="av-thumb" data-format={video.format}>
          <img src={video.thumbnailUrl} alt="" />
          {video.durationSeconds ? <span className="av-thumb-time">{formatDuration(video.durationSeconds)}</span> : null}
        </a>
      ) : null}

      <div className="av-hero-main">
        <div className="av-tags">
          <span className="av-tag" data-kind={video.format}>
            {video.format === "short" ? "Short" : "Video"}
          </span>
          <span className="av-tag">Posted {timeAgo(video.publishedAt, new Date(analysis.analyzedAt))}</span>
          <span className="av-tag">{new Date(video.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</span>
        </div>
        <h2>
          <a href={watchUrl(video)} target="_blank" rel="noreferrer">
            {video.title}
          </a>
        </h2>
        <a className="av-channel" href={`https://www.youtube.com/channel/${channel.id}`} target="_blank" rel="noreferrer">
          {channel.thumbnailUrl ? <img src={channel.thumbnailUrl} alt="" /> : <span className="av-channel-blank">{channel.title.slice(0, 1)}</span>}
          <span>
            <strong>{channel.title}</strong>
            <em>
              {channel.statistics.subscriberCount !== null ? `${formatCompact(channel.statistics.subscriberCount)} subscribers` : "subscribers hidden"} ·{" "}
              {formatCompact(channel.statistics.videoCount)} uploads
            </em>
          </span>
        </a>
        <div className="av-actions">
          <a className="av-action" href={watchUrl(video)} target="_blank" rel="noreferrer">
            <ExternalIcon size={14} /> Open on YouTube
          </a>
          {video.format === "short" ? (
            <Link className="av-action" href={`/research/scriptwriter?idea=${encodeURIComponent(video.title.slice(0, 300))}`}>
              <PenIcon size={14} /> Write a Short like this
            </Link>
          ) : null}
        </div>
      </div>

      <div className="av-score" data-tone={verdict.tone}>
        <div className="av-ring" role="img" aria-label={pct !== null ? `Beat ${Math.round(pct * 100)}% of the channel's recent uploads` : "No ranking"}>
          <svg viewBox="0 0 128 128" aria-hidden="true">
            <circle className="av-ring-track" cx="64" cy="64" r={R} />
            {pct !== null ? <circle className="av-ring-fill" cx="64" cy="64" r={R} strokeDasharray={`${Math.max(pct, 0.02) * C} ${C}`} /> : null}
          </svg>
          <span className="av-ring-value">
            <strong>{formatMultiplier(metrics.outlierScore)}</strong>
            <em>vs usual</em>
          </span>
        </div>
        <div className="av-score-text">
          <strong>{verdict.title}</strong>
          {breakdown.beats ? (
            <span>
              Beat <b>{breakdown.beats.count}</b> of its last {breakdown.beats.of} {video.format === "short" ? "Shorts" : "videos"}
            </span>
          ) : null}
          {metrics.channelMedianViews !== null ? (
            <span>
              Typical {label}: <b>{formatCompact(metrics.channelMedianViews)}</b> views
            </span>
          ) : null}
          {pct !== null ? <span className="av-score-pill">Top {Math.max(1, Math.round((1 - pct) * 100))}% on the channel</span> : null}
        </div>
      </div>
    </section>
  );
}

function Kpi({ icon, label, value, note, ratio }: { icon: ReactNode; label: string; value: string; note: string; ratio?: number | null }) {
  const s = standing(ratio ?? null);
  return (
    <div className="av-kpi">
      <span className="av-kpi-label">
        {icon}
        {label}
      </span>
      <span className="av-kpi-value">{value}</span>
      <span className="av-kpi-foot">
        {s && ratio != null ? (
          <span className="av-chip" data-tone={s.tone}>
            {ratio >= 1 ? "↑" : "↓"} {ratioText(ratio)}
          </span>
        ) : null}
        <span title={note}>{note}</span>
      </span>
    </div>
  );
}

function Kpis({ analysis }: { analysis: VideoAnalysis }) {
  const { video, metrics, insights } = analysis;
  const ch = insights.channel;
  const reach = insights.viewsPerSubscriber;
  return (
    <div className="av-kpis">
      <Kpi
        icon={<EyeIcon size={14} />}
        label="Views"
        value={formatCompact(video.statistics.viewCount)}
        note={metrics.viewsDelta24h ? `+${formatCompact(metrics.viewsDelta24h)} in the last day` : `usual ${formatCompact(metrics.channelMedianViews)}`}
        ratio={metrics.outlierScore}
      />
      <Kpi icon={<ZapIcon size={14} />} label="Views a day" value={formatCompact(metrics.viewsPerDay)} note={`usual ${formatCompact(ch.medianViewsPerDay)}`} ratio={ch.medianViewsPerDay ? metrics.viewsPerDay / ch.medianViewsPerDay : null} />
      <Kpi
        icon={<UsersIcon size={14} />}
        label="Reach"
        value={reach === null ? "—" : `${reach >= 10 ? Math.round(reach) : reach.toFixed(1)}×`}
        note={reach !== null && reach >= 1.5 ? "views per sub · new viewers" : "views per subscriber"}
      />
      <Kpi
        icon={<ThumbsUpIcon size={14} />}
        label="Like rate"
        value={formatPercent(insights.likeRate, 1)}
        note={`usual ${formatPercent(ch.likeRate, 1)} · ${formatCompact(video.statistics.likeCount)} likes`}
        ratio={insights.likeRate !== null && ch.likeRate ? insights.likeRate / ch.likeRate : null}
      />
      <Kpi
        icon={<MessageIcon size={14} />}
        label="Comments"
        value={formatCompact(video.statistics.commentCount)}
        note={`${formatPercent(insights.commentRate, 2)} · usual ${formatPercent(ch.commentRate, 2)}`}
        ratio={insights.commentRate !== null && ch.commentRate ? insights.commentRate / ch.commentRate : null}
      />
    </div>
  );
}

const MEASURE_LABEL: Record<BreakdownMeasure["key"], { label: string; hint: string }> = {
  views: { label: "Total views", hint: "against the channel's typical upload" },
  pace: { label: "Views a day", hint: "views since upload, per day" },
  likes: { label: "Like rate", hint: "likes per view" },
  comments: { label: "Comment rate", hint: "comments per view" },
};

function formatMeasure(key: BreakdownMeasure["key"], n: number | null) {
  if (key === "likes") return formatPercent(n, 1);
  if (key === "comments") return formatPercent(n, 2);
  return formatCompact(n);
}

/** Each measure as two bars, this video against the channel's usual, with a plain verdict. */
function Measures({ measures, kind }: { measures: BreakdownMeasure[]; kind: string }) {
  return (
    <section className="dash-panel av-measures" aria-label="Breakdown">
      <PanelHead title="Breakdown" note={`This video against the channel's usual ${kind}`} icon={<TargetIcon size={15} />} />
      <ul>
        {measures.map((m) => {
          const s = standing(m.ratio);
          const top = Math.max(m.value ?? 0, m.usual ?? 0) || 1;
          const w = (n: number | null) => `${n === null ? 0 : Math.max((n / top) * 100, 1.5)}%`;
          return (
            <li key={m.key} data-tone={s?.tone ?? "flat"}>
              <div className="av-measure-top">
                <span>
                  <strong>{MEASURE_LABEL[m.key].label}</strong>
                  <em>{MEASURE_LABEL[m.key].hint}</em>
                </span>
                {s ? (
                  <span className="av-chip" data-tone={s.tone}>
                    {ratioText(m.ratio)} · {s.text.toLowerCase()}
                  </span>
                ) : (
                  <span className="av-chip">no baseline</span>
                )}
              </div>
              <div className="av-bars">
                <span className="av-bar-row">
                  <span className="av-bar-key">This</span>
                  <span className="av-bar">
                    <span className="av-bar-fill" data-self="" style={{ width: w(m.value) }} />
                  </span>
                  <span className="av-bar-num">{formatMeasure(m.key, m.value)}</span>
                </span>
                <span className="av-bar-row">
                  <span className="av-bar-key">Usual</span>
                  <span className="av-bar">
                    <span className="av-bar-fill" style={{ width: w(m.usual) }} />
                  </span>
                  <span className="av-bar-num">{formatMeasure(m.key, m.usual)}</span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Where it lands: every recent upload on one line, and the channel's best ones to compare titles with. */
function Standing({ analysis, breakdown, kind }: { analysis: VideoAnalysis; breakdown: VideoBreakdown; kind: string }) {
  const { strip, top } = breakdown;
  // Spread dots that would sit on top of each other over a few lanes.
  const lanes: number[] = [];
  const placed = (strip?.points ?? [])
    .toSorted((a, b) => a.pos - b.pos)
    .map((p) => {
      let lane = lanes.findIndex((end) => p.pos - end > 0.022);
      if (lane === -1) lane = lanes.length < 4 ? lanes.length : lanes.indexOf(Math.min(...lanes));
      lanes[lane] = p.pos;
      return { ...p, lane };
    });

  return (
    <section className="dash-panel av-standing" aria-label="Where it lands">
      <PanelHead title="Where it lands" note={`The channel's last ${analysis.peers.length + 1} ${kind} by views, log scale`} icon={<TrendingIcon size={15} />} />
      {strip ? (
        <div className="av-strip">
          <div className="av-strip-track" style={{ height: `${Math.max(lanes.length, 1) * 13 + 34}px` }}>
            {strip.median !== null ? <span className="av-strip-mline" style={{ left: `${strip.median * 100}%` }} aria-hidden="true" /> : null}
            {placed.map((p) => (
              <a
                key={p.id}
                className="av-dot"
                href={`https://www.youtube.com/watch?v=${p.id}`}
                target="_blank"
                rel="noreferrer"
                style={{ left: `${p.pos * 100}%`, bottom: `${p.lane * 13 + 8}px` }}
                title={`${p.title} · ${formatCompact(p.views)} views`}
                aria-label={`${p.title}: ${formatCompact(p.views)} views`}
              />
            ))}
            <span
              className="av-strip-self"
              style={{ left: `${strip.self * 100}%` }}
              data-edge={strip.self > 0.8 ? "end" : strip.self < 0.2 ? "start" : undefined}
              title={`This one · ${formatCompact(analysis.video.statistics.viewCount)} views`}
            >
              <em>This one · {formatCompact(analysis.video.statistics.viewCount)}</em>
            </span>
          </div>
          <div className="av-strip-axis">
            <span>{formatCompact(strip.min)}</span>
            {strip.median !== null ? (
              <span className="av-strip-median" style={{ left: `${strip.median * 100}%` }}>
                typical
              </span>
            ) : null}
            <span>{formatCompact(strip.max)}</span>
          </div>
        </div>
      ) : (
        <p className="az-note">Not enough recent uploads on this channel to plot.</p>
      )}

      {top.length > 0 ? (
        <>
          <h3 className="av-subhead">
            <FlameIcon size={14} /> The channel&apos;s best lately
          </h3>
          <ul className="av-top">
            {top.map(({ video: v, multiple }) => (
              <li key={v.id}>
                <a href={watchUrl(v)} target="_blank" rel="noreferrer">
                  {v.thumbnailUrl ? <img src={v.thumbnailUrl} alt="" /> : <span className="av-top-blank" />}
                  <span className="av-top-text">
                    <strong>{v.title}</strong>
                    <em>
                      {formatCompact(v.statistics.viewCount)} views · {timeAgo(v.publishedAt, new Date(analysis.analyzedAt))}
                    </em>
                  </span>
                  <span className="av-chip" data-tone={multiple >= 1.5 ? "hot" : multiple >= 1.1 ? "up" : "flat"}>
                    {formatMultiplier(multiple)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
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
      <header className="dash-panel-head av-head">
        <div className="dash-panel-titles">
          <span className="av-head-icon">
            <CalendarIcon size={15} />
          </span>
          <h2>Upload by upload</h2>
          <p>
            The channel&apos;s recent {kind}, oldest to newest · hover a bar for the title
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
              href={watchUrl(v)}
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

function Highlights({ analysis, kind }: { analysis: VideoAnalysis; kind: string }) {
  const icon = { good: <TrendingIcon size={15} />, bad: <TrendingDownIcon size={15} />, info: <InfoIcon size={15} /> };
  return (
    <section className="dash-panel av-highlights" aria-label="What stands out">
      <PanelHead title="What stands out" note={`Measured against the channel's ${analysis.peers.length} other recent ${kind}`} icon={<ZapIcon size={15} />} />
      <ul>
        {analysis.insights.highlights.map((h) => (
          <li key={h.text} data-tone={h.tone}>
            <span className="av-hl-icon">{icon[h.tone]}</span>
            <span>{h.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Median multiple per group (posting day, length), this video's group marked and the best one called out. */
function GroupChart({ title, note, icon, groups, best, kind }: { title: string; note: string; icon: ReactNode; groups: GroupStat[]; best: number | null; kind: string }) {
  const max = Math.max(...groups.map((g) => g.multiple ?? 0), 1.2);
  const current = groups.find((g) => g.current);
  const bestGroup = best !== null ? groups[best] : null;
  return (
    <section className="dash-panel av-groups" aria-label={title}>
      <PanelHead
        title={title}
        note={note}
        icon={icon}
        action={
          <span className="av-legend" aria-hidden="true">
            <i data-key="best" /> best <i data-key="this" /> this one <i data-key="base" /> 1× typical
          </span>
        }
      />
      <div className="av-cols-chart" style={{ "--base": String(1 / max) } as CSSProperties}>
        {groups.map((g, i) => (
          <div key={g.label} className="av-col-bar" data-current={g.current || undefined} data-best={i === best || undefined} data-empty={g.count === 0 || undefined} data-few={g.count === 1 || undefined}>
            <span className="av-col-value">{g.multiple !== null ? formatMultiplier(g.multiple) : "—"}</span>
            <span className="av-col-track">
              <span className="av-col-fill" style={{ height: `${g.multiple !== null ? Math.max((g.multiple / max) * 100, 3) : 0}%` }} />
            </span>
            <span className="av-col-label">{g.label}</span>
            <span className="av-col-count">
              {g.count === 0 ? "none" : g.count}
              {g.count > 0 ? <span className="av-col-count-word"> {g.count === 1 ? "upload" : "uploads"}</span> : null}
            </span>
          </div>
        ))}
      </div>
      <p className="av-group-note">
        {bestGroup ? (
          <>
            <b>{bestGroup.label}</b> does best on this channel ({formatMultiplier(bestGroup.multiple)} typical views).{" "}
          </>
        ) : null}
        {current ? (
          bestGroup && current.label === bestGroup.label ? (
            <>This one landed in it.</>
          ) : (
            <>
              This one is <b>{current.label}</b>.
            </>
          )
        ) : null}{" "}
        Only {kind} at least 3 days old count.
      </p>
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

function Packaging({ analysis, breakdown }: { analysis: VideoAnalysis; breakdown: VideoBreakdown }) {
  const { video, insights } = analysis;
  const { channel, title, posted, hashtags } = insights;
  const rows: { label: string; value: string; usual: string | null }[] = [
    { label: "Title", value: `${title.words} words · ${[...video.title].length} characters`, usual: channel.titleWords !== null ? `${channel.titleWords} words` : null },
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
  const shares = new Map(title.traits.map((t) => [t.key, t.channelShare]));

  return (
    <section className="dash-panel av-packaging" aria-label="Title and packaging">
      <PanelHead title="Title & packaging" note="This video next to the channel's usual" icon={<PenIcon size={15} />} />
      <dl className="av-rows">
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

      <h3 className="av-subhead">What titles do on this channel</h3>
      <div className="av-table-wrap">
        <table className="av-traits">
          <thead>
            <tr>
              <th>Title has</th>
              <th>This one</th>
              <th className="num">Channel uses</th>
              <th className="num">With it</th>
              <th className="num">Without</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.traits.map((t) => {
              const share = shares.get(t.key);
              const wins = t.withIt !== null && t.without !== null && t.withIt >= t.without * 1.2;
              const loses = t.withIt !== null && t.without !== null && t.withIt * 1.2 <= t.without;
              return (
                <tr key={t.key}>
                  <td>{TRAIT_LABEL[t.key]}</td>
                  <td>
                    <span className="av-check" data-has={t.has || undefined}>
                      {t.has ? "✓" : "–"}
                    </span>
                  </td>
                  <td className="num">{share != null ? `${Math.round(share * 100)}%` : "—"}</td>
                  <td className="num" data-tone={wins ? "hot" : loses ? "down" : undefined}>
                    {t.withIt !== null ? formatMultiplier(t.withIt) : "—"}
                  </td>
                  <td className="num">{t.without !== null ? formatMultiplier(t.without) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="av-group-note">&ldquo;With it&rdquo; and &ldquo;Without&rdquo; are median views against the typical upload, for titles that have it and titles that don&apos;t. Lime means it clearly helps here.</p>

      {hashtags.length > 0 || video.tags.length > 0 ? (
        <div className="av-tagcloud">
          {hashtags.map((tag) => (
            <span key={tag} data-kind="hashtag">
              {tag}
            </span>
          ))}
          {video.tags.slice(0, 12).map((tag, i) => (
            <span key={`${i}-${tag}`}>{tag}</span>
          ))}
          {video.tags.length > 12 ? <span data-kind="more">+{video.tags.length - 12} tags</span> : null}
        </div>
      ) : null}
    </section>
  );
}

function Hook({ hook }: { hook: NonNullable<VideoAnalysis["hook"]> }) {
  const pace = hook.wordsPerSecond;
  const paceWord = pace === null ? null : pace >= 3 ? "fast" : pace >= 2.2 ? "normal" : "slow";
  return (
    <section className="dash-panel av-hook" aria-label="The hook">
      <PanelHead title="The hook" note="What it says in the first 3 seconds" icon={<MessageIcon size={15} />} />
      <blockquote>&ldquo;{hook.opening}&rdquo;</blockquote>
      <div className="av-mini-stats">
        <div>
          <span>Spoken words</span>
          <strong>{formatNumber(hook.words)}</strong>
        </div>
        {pace !== null ? (
          <div>
            <span>Pace</span>
            <strong>
              {pace} <small>words/s</small>
            </strong>
            <em data-pace={paceWord}>{paceWord}</em>
          </div>
        ) : null}
        <div>
          <span>Opening</span>
          <strong>
            {hook.opening.split(/\s+/).filter(Boolean).length} <small>words</small>
          </strong>
        </div>
      </div>
    </section>
  );
}

function Momentum({ analysis, breakdown }: { analysis: VideoAnalysis; breakdown: VideoBreakdown }) {
  const m = breakdown.momentum;
  return (
    <section className="dash-panel av-momentum" aria-label="Momentum">
      <PanelHead title="Momentum" note="From Outlier's checks on this video" icon={<TrendingIcon size={15} />} />
      {m ? (
        <div className="av-mini-stats">
          <div>
            <span>Last 24h</span>
            <strong>{m.last24h !== null ? `+${formatCompact(m.last24h)}` : "—"}</strong>
          </div>
          {m.last7d !== null || analysis.history.length === 0 ? (
            <div>
              <span>Last 7 days</span>
              <strong>{m.last7d !== null ? `+${formatCompact(m.last7d)}` : "—"}</strong>
            </div>
          ) : (
            <div>
              <span>Checked since</span>
              <strong>{shortDate.format(new Date(analysis.history[0]!.t))}</strong>
              <em>{analysis.history.length} checks</em>
            </div>
          )}
          <div>
            <span>Of all views</span>
            <strong>{m.share24h !== null ? formatPercent(m.share24h, 1) : "—"}</strong>
            <em>in the last day</em>
          </div>
        </div>
      ) : null}
      {analysis.history.length >= 3 ? <LineChart points={analysis.history.map((h) => ({ t: h.t, value: h.views }))} label="Views" /> : null}
    </section>
  );
}
