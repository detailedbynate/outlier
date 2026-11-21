/* eslint-disable @next/next/no-img-element -- YouTube images are already CDN-optimized */
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { ExternalIcon } from "@/components/icons";
import { LineChart } from "@/components/line-chart";
import { VideoCard } from "@/components/video-card";
import { WatchGrid } from "@/components/watch-grid";
import { watchItems } from "@/components/watch-items";
import { channelGrowth } from "@/lib/analytics/dashboard";
import { channelPatterns, hitRate } from "@/lib/analytics/channel-patterns";
import { median } from "@/lib/analytics/metrics";
import { PRESENTATIONS, TONES, VIDEO_STYLES, termDescription, termLabel } from "@/lib/breakdowns/taxonomy";
import { daysAgo, formatCompact, formatDuration, formatMultiplier, formatNumber, timeAgo } from "@/lib/format";
import { requireApprovedUser } from "@/lib/auth/session";
import { Paywall } from "@/components/paywall";
import { paidFeaturesLocked } from "@/lib/billing/feature-gate";
import { PAID_FEATURES } from "@/lib/billing/features";
import { getServices } from "@/lib/services";
import { CHANNEL_ID_PATTERN } from "@/lib/youtube/parse";
import { CREDIT_COSTS } from "@/lib/services/credits-service";
import type { ChannelTraitRow, VideoBreakdownRow, VideoFeedRow } from "@/types/database";
import { AddChannel } from "../../research/shorts-channels/add-channel";
import { setChannelTracked } from "../../research/shorts-channels/actions";

export const dynamic = "force-dynamic";

/** Uploads shown before "Show all". */
const FIRST_UPLOADS = 10;
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/**
 * One channel, read for what it tells a creator: how it's growing, how each
 * upload did against its usual, what tends to work there, and its biggest
 * hits, which play right on the page.
 */
export default async function ChannelPage({ params }: { params: Promise<{ id: string }> }) {
  const current = await requireApprovedUser();
  // Free is Shorts Channels only: show the paywall before loading anything.
  if (await paidFeaturesLocked(current)) return <Paywall feature={PAID_FEATURES["tracked"]} />;
  const { id } = await params;
  if (!CHANNEL_ID_PATTERN.test(id)) notFound();

  const { repositories } = getServices();
  const channel = await repositories.channels.findByYouTubeId(id);
  // Any channel can be opened: one we don't have yet is pulled in on request.
  if (!channel) {
    return (
      <div className="stack">
        <AddChannel reference={id} cost={CREDIT_COSTS.add_channel} then="channel" />
      </div>
    );
  }

  const [snapshots, videos, traits, followed] = await Promise.all([
    repositories.channels.listSnapshots(channel.id, daysAgo(365)),
    repositories.videos.feed({ orderBy: "published_at", limit: 60, youtubeChannelId: id }),
    repositories.traits
      .forChannels([channel.id])
      .then((rows) => rows.get(channel.id) ?? null)
      .catch(() => null),
    repositories.channels
      .followedIds(current.user.id, [channel.id])
      .then((ids) => ids.has(channel.id))
      .catch(() => false),
  ]);

  const topOutliers = videos
    .filter((v) => v.outlier_score !== null)
    .toSorted((a, b) => (b.outlier_score ?? 0) - (a.outlier_score ?? 0))
    .slice(0, 6);
  const breakdowns: Map<string, VideoBreakdownRow> = await repositories.breakdowns.forVideos(topOutliers.map((v) => v.video_id)).catch(() => new Map());

  const growth = channelGrowth(snapshots);
  // Views on uploads still in their first days aren't settled: leave them out of "typical".
  const settledBefore = daysAgo(3).getTime();
  const settled = videos.filter((v) => Date.parse(v.published_at) < settledBefore).slice(0, 20);
  const typical = median(settled.map((v) => v.view_count));
  const monthAgo = daysAgo(30).getTime();
  const lastMonth = videos.filter((v) => Date.parse(v.published_at) >= monthAgo).length;
  const hits = hitRate(videos.slice(0, 30));
  const patterns = channelPatterns(videos);
  const subscriberPoints = snapshots.filter((s) => s.subscriber_count !== null).map((s) => ({ t: s.captured_at, value: s.subscriber_count! }));

  return (
    <div className="stack ch">
      <Hero channel={channel} traits={traits} followed={followed} />

      <dl className="ch-stats">
        <div style={{ "--i": 0 } as CSSProperties}>
          <dt>Subscribers</dt>
          <dd>{channel.hidden_subscriber_count ? "Hidden" : formatCompact(channel.subscriber_count)}</dd>
          <Change value={growth.subs7d} suffix="this week" />
        </div>
        <div style={{ "--i": 1 } as CSSProperties}>
          <dt>Views gained this week</dt>
          <dd>{growth.views7d === null ? "—" : `+${formatCompact(growth.views7d)}`}</dd>
          <small>{growth.views24h === null ? "Fills in after a few daily syncs" : `+${formatCompact(growth.views24h)} in the last day`}</small>
        </div>
        <div style={{ "--i": 2 } as CSSProperties}>
          <dt>Uploads, last 30 days</dt>
          <dd>{lastMonth}</dd>
          <small>
            {lastMonth > 1 ? `About one every ${Math.max(1, Math.round(30 / lastMonth))} day${Math.round(30 / lastMonth) === 1 ? "" : "s"}` : "Quiet lately"}
            {videos[0] ? ` · last ${timeAgo(videos[0].published_at)}` : ""}
          </small>
        </div>
        <div style={{ "--i": 3 } as CSSProperties}>
          <dt>Typical views per upload</dt>
          <dd>{typical === null ? "—" : formatCompact(typical)}</dd>
          <small>{hits.of > 0 ? `${hits.hits} of the last ${hits.of} doubled it` : `${formatNumber(channel.video_count)} videos in all`}</small>
        </div>
      </dl>

      <div className="ch-charts">
        <section className="ch-card" aria-labelledby="ch-subs-title">
          <header className="ch-card-head">
            <h2 id="ch-subs-title">Subscribers</h2>
            <p>{subscriberPoints.length > 1 ? `Since ${shortDate.format(new Date(subscriberPoints[0]!.t))}, one point per daily sync` : "The line fills in after a few daily syncs"}</p>
          </header>
          <LineChart label="Subscribers" points={subscriberPoints} />
        </section>
        <UploadBars videos={videos.slice(0, 30)} typical={typical} />
      </div>

      {patterns.length > 0 ? (
        <section className="ch-card ch-patterns" aria-labelledby="ch-patterns-title">
          <header className="ch-card-head">
            <h2 id="ch-patterns-title">What works on this channel</h2>
            <p>From its last {videos.length} uploads, scored against its own usual. Medians, so one lucky hit can&apos;t skew it.</p>
          </header>
          <ol>
            {patterns.map((p, i) => (
              <li key={p.key} style={{ "--i": i } as CSSProperties} data-tone={p.lift >= 1 ? "up" : "down"}>
                <span className="ch-pattern-lift">{p.lift >= 1 ? `+${Math.round((p.lift - 1) * 100)}%` : `−${Math.round((1 - p.lift) * 100)}%`}</span>
                <strong>{p.title}</strong>
                <span>{p.detail}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section aria-labelledby="ch-best-title">
        <header className="ch-section-head">
          <h2 id="ch-best-title">Biggest hits</h2>
          <p>Its uploads that beat its usual views by the most. Click one to watch it here.</p>
        </header>
        {topOutliers.length === 0 ? (
          <div className="card empty">No performance data yet.</div>
        ) : (
          <WatchGrid items={watchItems(topOutliers)}>
            {topOutliers.map((video) => (
              <VideoCard key={video.video_id} video={video} showChannel={false} breakdown={breakdowns.get(video.video_id)} />
            ))}
          </WatchGrid>
        )}
      </section>

      {videos.length > 0 ? (
        <section className="ch-card ch-uploads-card" aria-labelledby="ch-uploads-title">
          <header className="ch-card-head">
            <h2 id="ch-uploads-title">Every recent upload</h2>
            <p>Newest first. The bar is how it did against the channel&apos;s usual; lime means it at least doubled it.</p>
          </header>
          <WatchGrid items={watchItems(videos)} className="ch-uploads">
            {videos.slice(0, FIRST_UPLOADS).map((video, i) => (
              <UploadRow key={video.video_id} video={video} index={i} />
            ))}
            {videos.length > FIRST_UPLOADS ? (
              <details className="ch-more">
                <summary>
                  Show all {videos.length}
                  <span aria-hidden="true" className="ch-more-chevron" />
                </summary>
                <div className="ch-more-body">
                  {videos.slice(FIRST_UPLOADS).map((video) => (
                    <UploadRow key={video.video_id} video={video} index={0} />
                  ))}
                </div>
              </details>
            ) : null}
          </WatchGrid>
        </section>
      ) : null}
    </div>
  );
}

function Hero({ channel, traits, followed }: { channel: { id: string; title: string; handle: string | null; country: string | null; thumbnail_url: string | null; youtube_channel_id: string; last_synced_at: string | null }; traits: ChannelTraitRow | null; followed: boolean }) {
  const handle = channel.handle ? (channel.handle.startsWith("@") ? channel.handle : `@${channel.handle}`) : null;
  return (
    <header className="ch-hero">
      {channel.thumbnail_url ? <img className="ch-avatar" src={channel.thumbnail_url} alt="" /> : <span className="ch-avatar" />}
      <div className="ch-hero-text">
        <h1>{channel.title}</h1>
        <p className="ch-meta">
          {[handle, channel.country, `synced ${timeAgo(channel.last_synced_at)}`].filter(Boolean).join(" · ")}
          {traits?.faceless !== null && traits?.faceless !== undefined ? <span className="ch-face">{traits.faceless ? "Faceless" : "On camera"}</span> : null}
        </p>
        {traits?.summary ? <p className="ch-summary">{traits.summary}</p> : null}
        {traits?.summary ? (
          <div className="profile-tags ch-tags">
            {traits.main_style && traits.main_style !== "other" ? (
              <span className="profile-tag" title={termDescription(VIDEO_STYLES, traits.main_style)}>
                <span className="profile-tag-key">Style</span>
                {termLabel(VIDEO_STYLES, traits.main_style)}
              </span>
            ) : null}
            {traits.presentation && traits.presentation !== "mixed" ? (
              <span className="profile-tag" title={termDescription(PRESENTATIONS, traits.presentation)}>
                <span className="profile-tag-key">Format</span>
                {termLabel(PRESENTATIONS, traits.presentation)}
              </span>
            ) : null}
            {traits.tone && traits.tone !== "mixed" ? (
              <span className="profile-tag" title={termDescription(TONES, traits.tone)}>
                <span className="profile-tag-key">Tone</span>
                {termLabel(TONES, traits.tone)}
              </span>
            ) : null}
            {traits.audience ? (
              <span className="profile-tag">
                <span className="profile-tag-key">For</span>
                {traits.audience}
              </span>
            ) : null}
            {traits.content_pillars.map((pillar) => (
              <span key={pillar} className="profile-tag">
                {pillar}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="ch-actions">
        <form action={setChannelTracked}>
          <input type="hidden" name="channelId" value={channel.id} />
          <input type="hidden" name="tracked" value={followed ? "false" : "true"} />
          <button type="submit" className={followed ? "button-ghost ch-tracking" : "ch-track"} title={followed ? "Stop tracking" : undefined}>
            {followed ? "Tracking" : "Track channel"}
          </button>
        </form>
        <Link href={`/research/shorts-channels?similar=${channel.id}`} className="button-ghost">
          Find similar
        </Link>
        <a href={`https://www.youtube.com/channel/${channel.youtube_channel_id}`} target="_blank" rel="noreferrer" className="button-ghost" aria-label="Open on YouTube">
          YouTube <ExternalIcon size={13} />
        </a>
      </div>
    </header>
  );
}

function Change({ value, suffix }: { value: number | null; suffix: string }) {
  if (value === null) return <small>Fills in after a few daily syncs</small>;
  if (value === 0) return <small>No change {suffix}</small>;
  return (
    <small data-tone={value > 0 ? "up" : "down"}>
      {value > 0 ? "+" : "−"}
      {formatCompact(Math.abs(value))} {suffix}
    </small>
  );
}

/** Views for each of the last uploads, oldest to newest, against the channel's typical upload. */
function UploadBars({ videos, typical }: { videos: VideoFeedRow[]; typical: number | null }) {
  const bars = videos.toReversed();
  if (bars.length < 3) return null;
  const max = Math.max(...bars.map((v) => v.view_count), typical ?? 0, 1);
  const best = bars.reduce((top, v) => ((v.outlier_score ?? 0) > (top.outlier_score ?? 0) ? v : top), bars[0]!);
  const pct = (n: number) => `${Math.max((n / max) * 100, 1.5)}%`;
  return (
    <section className="ch-card ch-bars-card" aria-labelledby="ch-bars-title">
      <header className="ch-card-head">
        <h2 id="ch-bars-title">Views per upload</h2>
        <p>
          Last {bars.length} uploads{typical ? ` · dashed line is its typical ${formatCompact(typical)}` : ""}
        </p>
      </header>
      <div className="ch-bars" role="list">
        {typical ? <span className="ch-bars-typical" style={{ bottom: pct(typical) }} aria-hidden="true" /> : null}
        {bars.map((v, i) => {
          const isBest = v === best && (v.outlier_score ?? 0) >= 1.5;
          return (
            <a
              key={v.video_id}
              role="listitem"
              href={`https://www.youtube.com/watch?v=${v.youtube_video_id}`}
              target="_blank"
              rel="noreferrer"
              className="ch-bar"
              style={{ "--h": pct(v.view_count), "--i": i } as CSSProperties}
              data-above={typical !== null && v.view_count >= typical ? "" : undefined}
              data-best={isBest ? "" : undefined}
              data-edge={i < 3 ? "start" : i >= bars.length - 3 ? "end" : undefined}
              aria-label={`${v.title}: ${formatCompact(v.view_count)} views`}
            >
              <span className="ch-bar-fill">{isBest ? <span className="ch-bar-flag">{formatMultiplier(v.outlier_score)}</span> : null}</span>
              <span className="ch-bar-tip">
                <strong>{v.title}</strong>
                {formatCompact(v.view_count)} views{v.outlier_score !== null ? ` · ${formatMultiplier(v.outlier_score)} its usual` : ""} · {shortDate.format(new Date(v.published_at))}
              </span>
            </a>
          );
        })}
      </div>
    </section>
  );
}

function UploadRow({ video, index }: { video: VideoFeedRow; index: number }) {
  const score = video.outlier_score;
  const watch = `https://www.youtube.com/watch?v=${video.youtube_video_id}`;
  return (
    <div className="ch-upload" style={{ "--i": index } as CSSProperties}>
      <a className="ch-upload-thumb" href={watch} data-watch="" aria-label={`Watch ${video.title}`}>
        {video.thumbnail_url ? <img src={video.thumbnail_url} alt="" loading="lazy" /> : null}
        {video.duration_seconds ? <span>{formatDuration(video.duration_seconds)}</span> : null}
      </a>
      <div className="ch-upload-main">
        <a className="ch-upload-title" href={watch} data-watch="" title={video.title}>
          {video.title}
        </a>
        <small>
          {video.format === "short" ? "Short" : video.format === "long_form" ? "Video" : video.format} · {timeAgo(video.published_at)}
        </small>
      </div>
      <span className="ch-upload-num">
        {formatCompact(video.view_count)}
        <small>views</small>
      </span>
      <span className="ch-upload-num">
        {formatCompact(video.views_per_day)}
        <small>a day</small>
      </span>
      <span className="ch-upload-score" data-hot={score !== null && score >= 2 ? "" : undefined} style={{ "--s": score === null ? 0 : Math.min(score / 4, 1) } as CSSProperties}>
        <span className="ch-upload-meter" aria-hidden="true" />
        {score === null ? "—" : formatMultiplier(score)}
      </span>
    </div>
  );
}
