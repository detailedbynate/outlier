/* eslint-disable @next/next/no-img-element -- YouTube images are already CDN-optimized */
import Link from "next/link";
import { Dropdown } from "@/components/dropdown";
import {
  BookmarkIcon,
  CalendarIcon,
  ExternalIcon,
  EyeIcon,
  FilmIcon,
  MoreIcon,
  PlayCircleIcon,
  TrendingIcon,
  UsersIcon,
  ZapIcon,
} from "@/components/icons";
import { formatCompact, formatMultiplier, hoursSince, timeAgo } from "@/lib/format";
import type { ShortsChannelWithPreviews } from "@/lib/services/research-service";
import { setChannelTracked } from "./actions";

export function ChannelCard({
  channel,
  showVideos,
  badge,
  highlightGrowth = false,
}: {
  channel: ShortsChannelWithPreviews;
  showVideos: boolean;
  /** Emphasize the realtime growth row (when sorting by growth). */
  highlightGrowth?: boolean;
  /** e.g. the niche a trending pick was found in. */
  badge?: string;
}) {
  const youtubeUrl = `https://www.youtube.com/channel/${channel.youtube_channel_id}`;
  const topMultiplier = numberOrNull(channel.top_multiplier);

  return (
    <article className="channel-card">
      <header className="channel-card-head">
        <div className="channel-identity">
          {channel.thumbnail_url ? (
            <img className="avatar channel-avatar" src={channel.thumbnail_url} alt="" loading="lazy" />
          ) : (
            <div className="avatar channel-avatar" />
          )}
          <div style={{ minWidth: 0 }}>
            <div className="channel-name-row">
              <Link href={`/channels/${channel.youtube_channel_id}`} className="channel-name">
                {channel.title}
              </Link>
              <a href={youtubeUrl} target="_blank" rel="noreferrer" className="icon-link" aria-label={`Open ${channel.title} on YouTube`}>
                <ExternalIcon size={14} />
              </a>
              {badge ? <span className="niche-badge">{badge}</span> : null}
            </div>
            <div className="channel-meta">
              <UsersIcon size={13} />
              <span>{channel.hidden_subscriber_count ? "Hidden" : formatCompact(channel.subscriber_count)}</span>
              {channel.country ? <span>· {channel.country}</span> : null}
              {channel.handle ? <span className="hide-narrow">· {channel.handle}</span> : null}
            </div>
          </div>
        </div>

        <div className="channel-pills">
          <span className="pill" title="Average views per Short (recent Shorts)">
            <EyeIcon size={14} />
            <strong>{formatCompact(channel.avg_short_views)}</strong>
            <span className="pill-unit">AVG</span>
          </span>
          <span className="pill" title="Total channel views">
            <TrendingIcon size={14} />
            <strong>{formatCompact(channel.view_count)}</strong>
            <span className="pill-unit">TOTAL</span>
          </span>
          <span className="pill" title="Videos on the channel">
            <FilmIcon size={14} />
            <strong>{formatCompact(channel.video_count)}</strong>
            <span className="pill-unit">{channel.video_count === 1 ? "video" : "videos"}</span>
          </span>
          <span className="pill" title="When the channel was created">
            <CalendarIcon size={14} />
            <span>{channel.channel_created_at ? `Started ${timeAgo(channel.channel_created_at)}` : "Start date unknown"}</span>
          </span>
          <form action={setChannelTracked}>
            <input type="hidden" name="channelId" value={channel.channel_id} />
            <input type="hidden" name="tracked" value={String(!channel.tracked)} />
            <button
              type="submit"
              className={`icon-button ${channel.tracked ? "is-active" : ""}`}
              aria-pressed={channel.tracked}
              aria-label={channel.tracked ? "Stop tracking channel" : "Track channel"}
              title={channel.tracked ? "Tracked · refreshed daily" : "Track this channel"}
            >
              <BookmarkIcon size={15} filled={channel.tracked} />
            </button>
          </form>
          <Dropdown label={<MoreIcon size={16} />} align="end" className="icon-dropdown">
            <Link href={`/channels/${channel.youtube_channel_id}`} className="dropdown-item">
              View channel details
            </Link>
            <a href={youtubeUrl} target="_blank" rel="noreferrer" className="dropdown-item">
              Open on YouTube
            </a>
          </Dropdown>
        </div>
      </header>

      <div className={`growth-panel ${highlightGrowth ? "is-highlighted" : ""}`}>
        <div className="growth-panel-head">
          <span className="growth-label">
            <ZapIcon size={14} />
            Realtime
          </span>
          {channel.views_24h === null && channel.views_48h === null ? (
            <span className="growth-note">24h/48h growth appears after ~24 hours of snapshots</span>
          ) : null}
        </div>
        <div className="growth-tiles">
          <VphStat live={numberOrNull(channel.live_vph)} recent={numberOrNull(channel.recent_vph)} />
          {channel.views_24h === null && channel.views_48h === null ? null : (
            <>
              <GrowthStat label="views 24h" value={channel.views_24h} />
              <GrowthStat label="views 48h" value={channel.views_48h} />
              <GrowthStat label="subs 24h" value={channel.hidden_subscriber_count ? null : channel.subs_24h} />
              <GrowthStat label="subs 48h" value={channel.hidden_subscriber_count ? null : channel.subs_48h} />
            </>
          )}
        </div>
      </div>

      <div className="channel-facts">
        <span title="Shorts posted in the last 30 days">
          <strong>{channel.shorts_last_30d}</strong> Shorts/30d
        </span>
        <span className="dot-sep" title="Median views of recent Shorts">
          <strong>{formatCompact(channel.median_short_views)}</strong> median
        </span>
        <span
          className={`dot-sep ${topMultiplier !== null && topMultiplier >= 2.5 ? "signal-hot" : ""}`}
          title={`Top Short's views (${formatCompact(channel.top_short_views)}) ÷ the channel's median Short`}
        >
          <strong>{formatMultiplier(topMultiplier)}</strong> top Short
        </span>
        <span className="facts-right muted" title="The rest of this channel's numbers are on its details page">
          Last Short {timeAgo(channel.last_short_at)}
        </span>
      </div>

      {showVideos && channel.recentShorts.length > 0 ? (
        <div className="recent-shorts">
          <div className="recent-shorts-title">
            <PlayCircleIcon size={14} className="accent-icon" />
            Recent Shorts ({channel.recentShorts.length})
          </div>
          <div className="shorts-strip">
            {channel.recentShorts.map((video) => (
              <a
                key={video.youtube_video_id}
                href={`https://www.youtube.com/shorts/${video.youtube_video_id}`}
                target="_blank"
                rel="noreferrer"
                className="short-thumb"
                title={video.title}
              >
                {/* hqdefault (480px) instead of the stored maxres image: plenty for a 120px card, a fraction of the bytes. */}
                <img src={`https://i.ytimg.com/vi/${video.youtube_video_id}/hqdefault.jpg`} alt={video.title} loading="lazy" />
                <ShortMultiplier views={video.view_count} median={channel.median_short_views} />
                <span className="short-views">
                  <EyeIcon size={12} />
                  {formatCompact(video.view_count)}
                  <ShortVph views={video.view_count} publishedAt={video.published_at} monitored={numberOrNull(video.views_per_hour)} />
                </span>
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

/** Postgres numerics can arrive as strings; normalize for display. */
function numberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Channel views per hour: live (from monitoring checks) when available, otherwise the since-upload average of this week's Shorts. */
function VphStat({ live, recent }: { live: number | null; recent: number | null }) {
  const value = live ?? recent;
  return (
    <span
      className="growth-tile"
      data-direction={value ? "up" : "flat"}
      title={live !== null ? "Current views per hour across recently checked Shorts" : "Average views per hour since upload, Shorts from the last 7 days"}
    >
      <strong>{value === null ? "—" : formatCompact(Math.round(value))}</strong>
      <span className="growth-tile-label">views/hr{live === null && recent !== null ? " · 7d avg" : ""}</span>
    </span>
  );
}

/** Views per hour for a recent Short (monitored value, else since upload). Hidden for Shorts older than a week. */
function ShortVph({ views, publishedAt, monitored }: { views: number; publishedAt: string; monitored: number | null }) {
  const ageHours = hoursSince(publishedAt);
  if (!Number.isFinite(ageHours) || ageHours > 7 * 24) return null;
  const vph = monitored ?? views / Math.max(ageHours, 1);
  return <span className="short-vph">· {formatCompact(Math.round(vph))}/h</span>;
}

/** Badge a recent Short that beat the channel's median by 1.5× or more. */
function ShortMultiplier({ views, median }: { views: number | null; median: number | null }) {
  if (!views || !median || median <= 0) return null;
  const multiplier = views / median;
  if (multiplier < 1.5) return null;
  return <span className="outlier-badge recent-multiplier">{formatMultiplier(multiplier)}</span>;
}

function GrowthStat({ label, value }: { label: string; value: number | null }) {
  if (value === null) {
    return (
      <span className="growth-tile">
        <strong className="muted">—</strong>
        <span className="growth-tile-label">{label}</span>
      </span>
    );
  }
  const direction = value > 0 ? "up" : value < 0 ? "down" : "flat";
  return (
    <span className="growth-tile" data-direction={direction}>
      <strong>
        {value > 0 ? "+" : value < 0 ? "−" : ""}
        {formatCompact(Math.abs(value))}
      </strong>
      <span className="growth-tile-label">{label}</span>
    </span>
  );
}