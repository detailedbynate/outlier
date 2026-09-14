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
import { formatCompact, formatPercent, timeAgo } from "@/lib/format";
import type { ShortsChannelWithPreviews } from "@/lib/services/research-service";
import { setChannelTracked } from "./actions";

export function ChannelCard({
  channel,
  showVideos,
  badge,
}: {
  channel: ShortsChannelWithPreviews;
  showVideos: boolean;
  /** e.g. the niche a trending pick was found in. */
  badge?: string;
}) {
  const youtubeUrl = `https://www.youtube.com/channel/${channel.youtube_channel_id}`;

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

      <div className="channel-stats-row">
        <ZapIcon size={14} className="accent-icon" />
        <span>
          <strong>{channel.shorts_last_30d}</strong> Shorts in 30 days
        </span>
        <span className="dot-sep">Median {formatCompact(channel.median_short_views)}</span>
        <span className="dot-sep">Top Short {formatCompact(channel.top_short_views)}</span>
        <span className="dot-sep">{formatPercent(channel.shorts_share, 0)} Shorts</span>
        <span className="stats-right muted">Last Short {timeAgo(channel.last_short_at)}</span>
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
                <span className="short-views">
                  <EyeIcon size={12} />
                  {formatCompact(video.view_count)}
                </span>
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}
