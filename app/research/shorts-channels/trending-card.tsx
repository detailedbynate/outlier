/* eslint-disable @next/next/no-img-element -- YouTube images are already CDN-optimized */
import { EyeIcon, UsersIcon, ZapIcon } from "@/components/icons";
import { formatCompact, formatMultiplier, formatPercent, timeAgo } from "@/lib/format";
import type { TrendingPickView } from "@/lib/services/trending-service";
import { removeTrendingPick } from "./actions";

/** One breakout Short: the video, its channel, and why it's an outlier. */
export function TrendingCard({ pick, isAdmin }: { pick: TrendingPickView; isAdmin: boolean }) {
  const multiplier = pick.outlier_multiplier === null ? null : Number(pick.outlier_multiplier);
  return (
    <article className="trend-card">
      <a
        href={`https://www.youtube.com/shorts/${pick.youtube_video_id}`}
        target="_blank"
        rel="noreferrer"
        className="short-thumb trend-thumb"
        title={pick.video_title}
      >
        <img src={`https://i.ytimg.com/vi/${pick.youtube_video_id}/hqdefault.jpg`} alt={pick.video_title} loading="lazy" />
        {multiplier !== null ? (
          <span className="outlier-badge" title={`${formatCompact(pick.video_views)} views vs a typical ${formatCompact(pick.channel_median_views)} for this channel`}>
            {formatMultiplier(multiplier)}
          </span>
        ) : null}
        <span className="short-views">
          <EyeIcon size={12} />
          {formatCompact(pick.video_views)}
        </span>
      </a>

      <div className="trend-body">
        <span className="niche-badge trend-niche">{pick.niche}</span>
        <a href={`https://www.youtube.com/shorts/${pick.youtube_video_id}`} target="_blank" rel="noreferrer" className="trend-title">
          {pick.video_title}
        </a>
        <a href={`https://www.youtube.com/channel/${pick.youtube_channel_id}`} target="_blank" rel="noreferrer" className="trend-channel">
          {pick.channel_thumbnail_url ? <img className="avatar" src={pick.channel_thumbnail_url} alt="" loading="lazy" /> : null}
          <span className="trend-channel-name">{pick.channel_title}</span>
          <span className="muted">
            <UsersIcon size={12} /> {formatCompact(pick.subscriber_count)}
          </span>
        </a>

        <dl className="trend-stats">
          <div>
            <dt>Channel usual</dt>
            <dd>{formatCompact(pick.channel_median_views)}</dd>
          </div>
          <div>
            <dt>Views / sub</dt>
            <dd>{pick.viewsPerSub === null ? "—" : `${pick.viewsPerSub}×`}</dd>
          </div>
          <div>
            <dt>Engagement</dt>
            <dd>{formatPercent(pick.engagement)}</dd>
          </div>
          <div>
            <dt>Posted</dt>
            <dd>{pick.video_published_at ? timeAgo(pick.video_published_at) : "—"}</dd>
          </div>
        </dl>

        <div className="trend-growth">
          <ZapIcon size={12} />
          <Gain label="1h" value={pick.views_1h} />
          <Gain label="24h" value={pick.views_24h} />
          {pick.views_1h === null && pick.views_24h === null ? <span className="muted">Tracking hourly</span> : null}
        </div>

        {isAdmin ? (
          <form action={removeTrendingPick} className="trend-admin">
            <input type="hidden" name="pickId" value={pick.id} />
            <button type="submit" className="button-ghost button-small">
              Remove
            </button>
          </form>
        ) : null}
      </div>
    </article>
  );
}

function Gain({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null;
  return (
    <span className="growth-stat" data-direction={value > 0 ? "up" : "flat"}>
      <strong>+{formatCompact(Math.max(value, 0))}</strong> {label}
    </span>
  );
}
