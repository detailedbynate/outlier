/* eslint-disable @next/next/no-img-element -- YouTube thumbnails are already CDN-optimized */
import Link from "next/link";
import { ANGLES, HOOK_TYPES, VIDEO_STYLES, termDescription, termLabel } from "@/lib/breakdowns/taxonomy";
import { formatCompact, formatMultiplier, timeAgo } from "@/lib/format";
import type { VideoBreakdownRow, VideoFeedRow } from "@/types/database";

export function VideoCard({ video, showChannel = true, breakdown }: { video: VideoFeedRow; showChannel?: boolean; breakdown?: VideoBreakdownRow | null }) {
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
      {breakdown ? <Breakdown breakdown={breakdown} /> : null}
    </article>
  );
}

/** "Why it blew up": Claude's read, collapsed until opened. */
function Breakdown({ breakdown }: { breakdown: VideoBreakdownRow }) {
  return (
    <details className="breakdown">
      <summary>
        <span>Why it blew up</span>
        <span className="breakdown-chevron" aria-hidden="true" />
      </summary>
      <div className="breakdown-body">
        <dl className="breakdown-terms">
          <div title={termDescription(HOOK_TYPES, breakdown.hook_type)}>
            <dt>Hook</dt>
            <dd>{termLabel(HOOK_TYPES, breakdown.hook_type)}</dd>
          </div>
          <div title={termDescription(VIDEO_STYLES, breakdown.style)}>
            <dt>Style</dt>
            <dd>{termLabel(VIDEO_STYLES, breakdown.style)}</dd>
          </div>
          <div title={termDescription(ANGLES, breakdown.angle)}>
            <dt>Angle</dt>
            <dd>{termLabel(ANGLES, breakdown.angle)}</dd>
          </div>
          <div>
            <dt>Topic</dt>
            <dd>{breakdown.topic}</dd>
          </div>
        </dl>
        <p className="breakdown-why">{breakdown.why_it_worked}</p>
        <div className="breakdown-row">
          <span className="breakdown-label">Title pattern</span>
          <span className="breakdown-pattern">{breakdown.title_pattern}</span>
        </div>
        <div className="breakdown-row">
          <span className="breakdown-label">Thumbnail</span>
          <span>{breakdown.thumbnail_style}</span>
        </div>
        <div className="breakdown-row breakdown-copy">
          <span className="breakdown-label">Make your own</span>
          <span>{breakdown.how_to_copy}</span>
        </div>
        {breakdown.tags.length > 0 ? (
          <div className="breakdown-tags">
            {breakdown.tags.map((tag) => (
              <span key={tag} className="badge">
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}
