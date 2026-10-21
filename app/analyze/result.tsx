/* eslint-disable @next/next/no-img-element -- YouTube images are already CDN-optimized */
import Link from "next/link";
import type { CSSProperties } from "react";
import { ChevronDownIcon, ExternalIcon } from "@/components/icons";
import { LineChart } from "@/components/line-chart";
import { videoBreakdown, type GroupStat, type VideoBreakdown } from "@/lib/analytics/video-breakdown";
import { ageText, isSettled, settleDays, WEEKDAYS, type TitleTraitKey } from "@/lib/analytics/video-insights";
import { formatCompact, formatDuration, formatMultiplier, formatNumber, formatPercent, timeAgo } from "@/lib/format";
import type { VideoAnalysis } from "@/lib/services/video-service";
import type { YouTubeVideo } from "@/types/youtube";

type Tone = "good" | "flat" | "bad";

/** The headline: how this one compares, or, while it's new, how far along it is. */
function verdictFor(analysis: VideoAnalysis): { tone: Tone | "none"; title: string } {
  const score = analysis.metrics.outlierScore;
  if (score === null) return { tone: "none", title: "Not enough history to compare" };
  if (analysis.insights.early) return score >= 1 ? { tone: "good", title: "Off to a fast start" } : { tone: "none", title: "Too early to call" };
  if (score >= 3) return { tone: "good", title: "Breakout" };
  if (score >= 1.5) return { tone: "good", title: "Well above its usual" };
  if (score >= 1.1) return { tone: "good", title: "A bit above its usual" };
  if (score >= 0.7) return { tone: "flat", title: "About its usual" };
  return { tone: "bad", title: "Below its usual" };
}

/** "+38%", "2.4×", "−20%" against the usual, or null when it's within 10%. */
function change(value: number | null, usual: number | null): { tone: Tone; text: string } | null {
  if (value === null || !usual) return null;
  const r = value / usual;
  if (Math.abs(r - 1) < 0.1) return { tone: "flat", text: "on par" };
  const text = r >= 2 ? formatMultiplier(r) : `${r >= 1 ? "+" : "−"}${Math.round(Math.abs(r - 1) * 100)}%`;
  return { tone: r >= 1 ? "good" : "bad", text };
}

const watchUrl = (v: YouTubeVideo) => (v.format === "short" ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`);
const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
/** Enough to tell the story; the rest would only repeat it. */
const MAX_HIGHLIGHTS = 5;

export function AnalysisResult({ analysis }: { analysis: VideoAnalysis }) {
  const { video, metrics, insights } = analysis;
  const now = new Date(analysis.analyzedAt);
  const breakdown = videoBreakdown(
    { video, peers: analysis.peers, insights, medianViews: metrics.channelMedianViews, growth: { last24h: metrics.viewsDelta24h, last7d: metrics.viewsDelta7d } },
    now,
  );
  const kind = video.format === "short" ? "Shorts" : "videos";
  const tracked = breakdown.momentum !== null || analysis.history.length >= 3;
  const takeaways = insights.highlights.length > (insights.early ? 1 : 0) ? <Takeaways key="t" analysis={analysis} /> : null;
  const hook = analysis.hook ? <Hook key="h" hook={analysis.hook} /> : null;
  // Two even columns: the hook sits under the takeaways when momentum has the other side, beside them when it doesn't.
  const columns = (tracked ? [[takeaways, hook], [<Momentum key="m" analysis={analysis} breakdown={breakdown} />]] : [[takeaways], [hook]]).map((col) => col.filter(Boolean));
  const filled = columns.filter((col) => col.length > 0);
  const more = breakdown.top.length > 0 || breakdown.weekdays !== null || breakdown.lengths !== null || insights.title.words > 0;

  return (
    <div className="va">
      <Summary analysis={analysis} breakdown={breakdown} />

      {analysis.peers.length >= 3 ? <PeersChart analysis={analysis} kind={kind} now={now} /> : null}

      {filled.length > 0 ? (
        <div className="va-pair" data-single={filled.length === 1 ? "" : undefined}>
          {filled.map((col, i) => (
            <div key={i} className="va-side">
              {col}
            </div>
          ))}
        </div>
      ) : null}

      {more ? <ChannelDetails analysis={analysis} breakdown={breakdown} kind={kind} now={now} /> : null}
    </div>
  );
}

/** The video, its channel, the verdict and the four numbers that matter, on one surface. */
function Summary({ analysis, breakdown }: { analysis: VideoAnalysis; breakdown: VideoBreakdown }) {
  const { video, channel, metrics, insights } = analysis;
  const now = new Date(analysis.analyzedAt);
  const verdict = verdictFor(analysis);
  const one = video.format === "short" ? "Short" : "video";
  const typical = metrics.channelMedianViews;
  const score = metrics.outlierScore;
  const early = insights.early;
  const ch = insights.channel;
  const reach = insights.viewsPerSubscriber;
  // Rates on a few hundred views, or a handful of comments, swing too much to call.
  const likesCount = video.statistics.viewCount >= 1000;
  const commentsCount = likesCount && (video.statistics.commentCount ?? 0) >= 20;

  return (
    <section className="va-summary" data-format={video.format}>
      <div className="va-video">
        {video.thumbnailUrl ? (
          <a href={watchUrl(video)} target="_blank" rel="noreferrer" className="va-thumb" data-format={video.format}>
            <img src={video.thumbnailUrl} alt="" />
            {video.durationSeconds ? <span>{formatDuration(video.durationSeconds)}</span> : null}
          </a>
        ) : null}
        <div className="va-video-text">
          <p className="va-meta">
            {video.format === "short" ? "Short" : "Video"} · posted {early ? `${ageText(insights.ageHours)} ago` : timeAgo(video.publishedAt, now)} · {dateFmt.format(new Date(video.publishedAt))}
          </p>
          <h2>
            <a href={watchUrl(video)} target="_blank" rel="noreferrer">
              {video.title}
            </a>
          </h2>
          <a className="va-channel" href={`https://www.youtube.com/channel/${channel.id}`} target="_blank" rel="noreferrer">
            {channel.thumbnailUrl ? <img src={channel.thumbnailUrl} alt="" /> : <span className="va-channel-blank">{channel.title.slice(0, 1)}</span>}
            <strong>{channel.title}</strong>
            <span>{channel.statistics.subscriberCount !== null ? `${formatCompact(channel.statistics.subscriberCount)} subscribers` : "subscribers hidden"}</span>
          </a>
          <div className="va-links">
            <a href={watchUrl(video)} target="_blank" rel="noreferrer">
              Open on YouTube <ExternalIcon size={13} />
            </a>
            {video.format === "short" ? <Link href={`/research/scriptwriter?idea=${encodeURIComponent(video.title.slice(0, 300))}`}>Write a Short like this</Link> : null}
          </div>
        </div>
      </div>

      <div className="va-verdict" data-tone={verdict.tone}>
        <p className="va-label">{early ? "Early read" : "Verdict"}</p>
        <p className="va-call">{verdict.title}</p>
        {score !== null && typical ? (
          early ? (
            <>
              <p className="va-big">
                {Math.round(score * 100)}%<small> of a typical {one}</small>
              </p>
              <span className="va-progress" style={{ "--p": Math.min(score, 1) } as CSSProperties} aria-hidden="true" />
              <p className="va-why">
                {formatCompact(video.statistics.viewCount)} views in {ageText(insights.ageHours)}. A typical {one} here ends up near {formatCompact(typical)}; {kindOf(video)} collect most views in the first{" "}
                {settleDays(video.format)} days, so check back after that.
              </p>
            </>
          ) : (
            <>
              <p className="va-big">
                {formatMultiplier(score)}
                <small> a typical {one}</small>
              </p>
              <p className="va-why">
                {formatCompact(video.statistics.viewCount)} views against a usual {formatCompact(typical)}
                {breakdown.beats ? `, more than ${breakdown.beats.count} of its last ${breakdown.beats.of} ${kindOf(video)}` : ""}.
              </p>
            </>
          )
        ) : (
          <p className="va-why">The channel hasn&apos;t posted enough {kindOf(video)} lately to say what&apos;s normal for it.</p>
        )}
      </div>

      <dl className="va-stats">
        <Stat label="Views" value={formatNumber(video.statistics.viewCount)} note={metrics.viewsDelta24h ? `+${formatCompact(metrics.viewsDelta24h)} in the last day` : early ? "so far" : `usual ${formatCompact(typical)}`} />
        <Stat label="Like rate" value={formatPercent(insights.likeRate, 1)} note={`usual ${formatPercent(ch.likeRate, 1)}`} delta={likesCount ? change(insights.likeRate, ch.likeRate) : null} />
        <Stat
          label="Comments"
          value={formatCompact(video.statistics.commentCount)}
          note={`${formatPercent(insights.commentRate, 2)} of views · usual ${formatPercent(ch.commentRate, 2)}`}
          delta={commentsCount ? change(insights.commentRate, ch.commentRate) : null}
        />
        <Stat label="Views per subscriber" value={reach === null ? "—" : reach >= 10 ? String(Math.round(reach)) : reach.toFixed(2)} note={reach !== null && reach >= 1.5 ? "reached far past its subscribers" : "how far past its subscribers it went"} />
      </dl>
    </section>
  );
}

const kindOf = (v: YouTubeVideo) => (v.format === "short" ? "Shorts" : "videos");

function Stat({ label, value, note, delta }: { label: string; value: string; note: string; delta?: { tone: Tone; text: string } | null }) {
  return (
    <div className="va-stat">
      <dt>{label}</dt>
      <dd>
        <span className="va-stat-value">
          {value}
          {delta ? <em data-tone={delta.tone}>{delta.text}</em> : null}
        </span>
        <span className="va-stat-note">{note}</span>
      </dd>
    </div>
  );
}

function Head({ title, note }: { title: string; note?: string }) {
  return (
    <header className="va-head">
      <h3>{title}</h3>
      {note ? <p>{note}</p> : null}
    </header>
  );
}

/** This video among the channel's recent uploads, oldest to newest. Uploads still collecting views are drawn faint. */
function PeersChart({ analysis, kind, now }: { analysis: VideoAnalysis; kind: string; now: Date }) {
  const { video } = analysis;
  const median = analysis.metrics.channelMedianViews;
  const bars = [...analysis.peers, video].sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt)).slice(-24);
  // One huge breakout would flatten every other bar to nothing. When the top bar
  // dwarfs the rest, scale to the runner-up and draw the top one cut off.
  const sorted = bars.map((v) => v.statistics.viewCount).sort((a, b) => b - a);
  const [top = 0, second = 0] = sorted;
  const broken = second > 0 && top > second * 3;
  const max = Math.max(broken ? second * 1.2 : top, median ?? 0, 1);
  const pct = (n: number) => `${Math.min(Math.max((n / max) * 100, 1.5), 100)}%`;
  const crowded = bars.length > 14;
  const fresh = bars.some((v) => !isSettled(v, now));

  return (
    <section className="va-panel va-chart" aria-label={`This video among the channel's recent ${kind}`}>
      <div className="va-chart-head">
        <Head title="Against its recent uploads" note={`Views on the channel's last ${bars.length} ${kind}, oldest first. Hover a bar for its title.`} />
        <div className="va-legend" aria-hidden="true">
          <span data-key="self">This one</span>
          {median ? <span data-key="median">Typical {formatCompact(median)}</span> : null}
          {fresh ? <span data-key="fresh">Still new</span> : null}
        </div>
      </div>
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
              data-fresh={!isSettled(v, now) || undefined}
              data-edge={i < 2 ? "start" : i >= bars.length - 2 ? "end" : undefined}
              data-broken={broken && v.statistics.viewCount > max ? "" : undefined}
              data-quiet-label={crowded && i % 2 === 1 && !self ? "" : undefined}
              data-tick={i % 4 === 0 || i === bars.length - 1 || undefined}
              aria-label={`${v.title}: ${formatCompact(v.statistics.viewCount)} views`}
            >
              <span className="home-bar-fill" style={{ height: pct(v.statistics.viewCount) }}>
                {self ? <span className="home-bar-flag">{formatCompact(v.statistics.viewCount)}</span> : null}
              </span>
              <span className="home-bar-tip">
                <strong>{v.title}</strong>
                {formatCompact(v.statistics.viewCount)} views{!isSettled(v, now) ? " so far" : ""}
              </span>
              <span className="home-bar-label">{shortDate.format(new Date(v.publishedAt))}</span>
            </a>
          );
        })}
      </div>
      {broken ? <p className="va-foot">The tallest bar is cut off so the rest stay readable.</p> : null}
    </section>
  );
}

function Takeaways({ analysis }: { analysis: VideoAnalysis }) {
  // While it's new the verdict already gives the early read; don't say it twice.
  const { early, highlights } = analysis.insights;
  const list = (early ? highlights.slice(1) : highlights).slice(0, MAX_HIGHLIGHTS);
  return (
    <section className="va-panel va-takeaways" aria-label="Takeaways">
      <Head title="Takeaways" />
      <ul>
        {list.map((h) => (
          <li key={h.text} data-tone={h.tone === "good" ? "good" : h.tone === "bad" ? "bad" : "flat"}>
            {h.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Hook({ hook }: { hook: NonNullable<VideoAnalysis["hook"]> }) {
  const pace = hook.wordsPerSecond;
  const paceWord = pace === null ? null : pace >= 3 ? "fast" : pace >= 2.2 ? "normal" : "slow";
  return (
    <section className="va-panel va-hook" aria-label="The hook">
      <Head title="The hook" note="First 3 seconds" />
      <blockquote>&ldquo;{hook.opening}&rdquo;</blockquote>
      <p className="va-foot">
        {formatNumber(hook.words)} words spoken{pace !== null ? ` · ${pace} words a second (${paceWord})` : ""}
      </p>
    </section>
  );
}

function Momentum({ analysis, breakdown }: { analysis: VideoAnalysis; breakdown: VideoBreakdown }) {
  const m = breakdown.momentum;
  return (
    <section className="va-panel va-momentum" aria-label="Momentum">
      <Head title="Momentum" note="From Outlier's checks on this video" />
      {m ? (
        <dl className="va-mini">
          {m.last24h !== null ? (
            <div>
              <dt>Last 24h</dt>
              <dd>+{formatCompact(m.last24h)}</dd>
            </div>
          ) : null}
          {m.last7d !== null ? (
            <div>
              <dt>Last 7 days</dt>
              <dd>+{formatCompact(m.last7d)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {analysis.history.length >= 3 ? <LineChart points={analysis.history.map((h) => ({ t: h.t, value: h.views }))} label="Views" /> : null}
    </section>
  );
}

const TRAIT_LABEL: Record<TitleTraitKey, string> = {
  number: "A number",
  question: "A question",
  caps: "A CAPS word",
  you: '"You"',
  emoji: "An emoji",
};

/** Everything about the channel rather than this video, folded away until asked for. */
function ChannelDetails({ analysis, breakdown, kind, now }: { analysis: VideoAnalysis; breakdown: VideoBreakdown; kind: string; now: Date }) {
  const { video, insights } = analysis;
  const { channel, title, posted, hashtags } = insights;
  const settle = settleDays(video.format);
  const traits = breakdown.traits.filter((t) => t.withIt !== null && t.without !== null);

  return (
    <details className="va-panel va-more">
      <summary>
        <span>
          <strong>What works on this channel</strong>
          <em>Its best recent {kind}, posting day, length and titles</em>
        </span>
        <ChevronDownIcon size={18} />
      </summary>

      <div className="va-more-body">
        {breakdown.top.length > 0 ? (
          <div className="va-block">
            <Head title="Its best lately" note="Views against a typical upload" />
            <ol className="va-top">
              {breakdown.top.map(({ video: v, multiple }) => (
                <li key={v.id}>
                  <a href={watchUrl(v)} target="_blank" rel="noreferrer">
                    {v.thumbnailUrl ? <img src={v.thumbnailUrl} alt="" /> : <span className="va-top-blank" />}
                    <span className="va-top-text">
                      <strong>{v.title}</strong>
                      <em>
                        {formatCompact(v.statistics.viewCount)} views · {timeAgo(v.publishedAt, now)}
                      </em>
                    </span>
                    <b>{formatMultiplier(multiple)}</b>
                  </a>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        <div className="va-block">
          <Head title="This one next to its usual" />
          <dl className="va-rows">
            <div>
              <dt>Title</dt>
              <dd>
                {title.words} words{channel.titleWords !== null ? <em>usually {channel.titleWords}</em> : null}
              </dd>
            </div>
            <div>
              <dt>Length</dt>
              <dd>
                {video.durationSeconds ? formatDuration(video.durationSeconds) : "—"}
                {channel.durationSeconds ? <em>usually {formatDuration(Math.round(channel.durationSeconds))}</em> : null}
              </dd>
            </div>
            <div>
              <dt>Posted</dt>
              <dd>
                {WEEKDAYS[posted.weekday]} {String(posted.hourUtc).padStart(2, "0")}:00 UTC
                {posted.channelTopWeekday !== null ? <em>mostly {WEEKDAYS[posted.channelTopWeekday]}s</em> : null}
              </dd>
            </div>
            <div>
              <dt>Upload pace</dt>
              <dd>{channel.uploadsPerWeek !== null ? `${channel.uploadsPerWeek} a week` : "—"}</dd>
            </div>
          </dl>
        </div>

        {breakdown.weekdays || breakdown.lengths ? (
          <div className="va-groups">
            {breakdown.weekdays ? <GroupChart title="Day posted" note="UTC" groups={breakdown.weekdays.days} best={breakdown.weekdays.best} /> : null}
            {breakdown.lengths ? <GroupChart title="Length" groups={breakdown.lengths.buckets} best={breakdown.lengths.best} /> : null}
          </div>
        ) : null}

        {traits.length > 0 ? (
          <div className="va-block">
            <Head title="Titles that work here" note="Typical views for titles with each, and without" />
            <ul className="va-traits">
              {traits.map((t) => {
                const wins = t.withIt! >= t.without! * 1.2;
                const loses = t.withIt! * 1.2 <= t.without!;
                return (
                  <li key={t.key} data-tone={wins ? "good" : loses ? "bad" : "flat"}>
                    <span>
                      {TRAIT_LABEL[t.key]}
                      {t.has ? <i>this one has it</i> : null}
                    </span>
                    <span>
                      <b>{formatMultiplier(t.withIt)}</b> with · {formatMultiplier(t.without)} without
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {hashtags.length > 0 || video.tags.length > 0 ? (
          <div className="va-block">
            <Head title="Tags" />
            <div className="va-tags">
              {hashtags.map((tag) => (
                <span key={tag} data-kind="hashtag">
                  {tag}
                </span>
              ))}
              {video.tags.slice(0, 12).map((tag, i) => (
                <span key={`${i}-${tag}`}>{tag}</span>
              ))}
              {video.tags.length > 12 ? <span data-kind="more">+{video.tags.length - 12} more</span> : null}
            </div>
          </div>
        ) : null}

        <p className="va-foot">Only {kind} at least {settle} days old count here, so new uploads don&apos;t drag the numbers down.</p>
      </div>
    </details>
  );
}

/** Typical views per group (posting day, length), this video's group marked and the best one called out. */
function GroupChart({ title, note, groups, best }: { title: string; note?: string; groups: GroupStat[]; best: number | null }) {
  const max = Math.max(...groups.map((g) => g.multiple ?? 0), 1.2);
  const bestGroup = best !== null ? groups[best] : null;
  return (
    <div className="va-block va-group" aria-label={title}>
      <Head title={bestGroup ? `${title}: ${bestGroup.label} does best` : title} note={note} />
      <div className="va-cols" style={{ "--base": String(1 / max) } as CSSProperties}>
        {groups.map((g, i) => (
          <div
            key={g.label}
            className="va-col"
            data-current={g.current || undefined}
            data-best={i === best || undefined}
            data-few={g.count <= 1 || undefined}
            title={`${g.count} ${g.count === 1 ? "upload" : "uploads"}`}
          >
            <span className="va-col-value">{g.multiple !== null ? formatMultiplier(g.multiple) : "—"}</span>
            <span className="va-col-track">
              <span className="va-col-fill" style={{ height: `${g.multiple !== null ? Math.max((g.multiple / max) * 100, 3) : 0}%` }} />
            </span>
            <span className="va-col-label">{g.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
