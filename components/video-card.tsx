/* eslint-disable @next/next/no-img-element -- YouTube thumbnails are already CDN-optimized */
import Link from "next/link";
import { formatCompact, formatMultiplier, timeAgo } from "@/lib/format";
import type { VideoFeedRow } from "@/types/database";

export function VideoCard({ video, showChannel = true }: { video: VideoFeedRow; showChannel?: boolean }) {
  return (
    <article className="card video-card">
      <a href={`https://www.youtube.com/watch?v=${video.youtube_video_id}`} target="_blank" rel="noreferrer">
        {video.thumbnail_url ? <img className="thumb" src={video.thumbnail_url} alt="" loading="lazy" /> : null}
      </a>
      <h3 className="video-title clamp" title={video.title}>
        {video.title}
      </h3>
      {showChannel ? (
        <div className="row" style={{ marginBottom: 8 }}>
          <Link href={`/channels/${video.youtube_channel_id}`} className="muted">
            {video.channel_title}
          </Link>
          <span className="muted">· {formatCompact(video.subscriber_count)} subs</span>
        </div>
      ) : null}
      <div className="metric-line">
        <span className="outlier" title="Views compared to the channel's typical video">
          {formatMultiplier(video.outlier_score)} outlier
        </span>
        <span>{formatCompact(video.view_count)} views</span>
        <span>{formatCompact(video.views_per_day)}/day</span>
      </div>
      <div className="metric-line" style={{ marginTop: 4 }}>
        <span className="badge">{video.format === "short" ? "Short" : video.format === "long_form" ? "Video" : video.format}</span>
        <span>{timeAgo(video.published_at)}</span>
      </div>
    </article>
  );
}
