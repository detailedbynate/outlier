/* eslint-disable @next/next/no-img-element -- YouTube images are already CDN-optimized */
import Link from "next/link";
import type { ScoredVideo, TrendLabel } from "@/lib/competitors/intel";
import { formatCompact, formatPercent, timeAgo } from "@/lib/format";

/** Small, data-first building blocks for competitor intelligence. No gradients. */

const TREND_TEXT: Record<TrendLabel, string> = {
  accelerating: "Accelerating",
  rising: "Rising",
  stable: "Stable",
  slowing: "Slowing",
  insufficient: "Collecting data",
};

export function TrendBadge({ label, title }: { label: TrendLabel; title?: string }) {
  return (
    <span className="intel-trend" data-trend={label} title={title}>
      {TREND_TEXT[label]}
    </span>
  );
}

export function Delta({ value, pct, suffix = "" }: { value: number | null; pct?: number | null; suffix?: string }) {
  if (value === null) return <span className="intel-delta" data-dir="none">—</span>;
  const dir = value > 0 ? "up" : value < 0 ? "down" : "flat";
  return (
    <span className="intel-delta" data-dir={dir}>
      {value > 0 ? "+" : value < 0 ? "−" : ""}
      {formatCompact(Math.abs(value))}
      {suffix}
      {pct !== undefined && pct !== null ? <small> ({pct > 0 ? "+" : ""}{(pct * 100).toFixed(1)}%)</small> : null}
    </span>
  );
}

export function Diff({ value }: { value: number | null }) {
  if (value === null) return <span className="intel-diff" data-dir="none">—</span>;
  const pct = Math.round(value * 100);
  return (
    <span className="intel-diff" data-dir={pct > 0 ? "up" : pct < 0 ? "down" : "flat"}>
      {pct > 0 ? "+" : ""}
      {pct}%
    </span>
  );
}

export function Multiplier({ value }: { value: number | null }) {
  if (value === null) return <span className="intel-mult" data-band="none">—</span>;
  const band = value >= 3 ? "hot" : value >= 1.5 ? "warm" : value < 0.8 ? "cold" : "normal";
  return (
    <span className="intel-mult" data-band={band} title="Views relative to the channel's normal performance">
      {value >= 10 ? Math.round(value) : value.toFixed(1)}×
    </span>
  );
}

/** Line chart of daily values; hidden when there isn't enough history to be meaningful. */
export function Sparkline({ points, label, height = 44 }: { points: { day: string; value: number }[]; label: string; height?: number }) {
  if (points.length < 3) return <span className="intel-muted">Needs a few days of history</span>;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 240;
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${((i / (points.length - 1)) * width).toFixed(1)},${(height - 4 - ((p.value - min) / span) * (height - 8)).toFixed(1)}`)
    .join(" ");
  return (
    <svg className="intel-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${label}: ${formatCompact(values[0]!)} to ${formatCompact(values.at(-1)!)} over ${points.length} days`}>
      <path d={d} />
    </svg>
  );
}

/** Weekly upload bars, Shorts and long-form stacked. */
export function WeeklyBars({ weeks }: { weeks: { weekStart: string; shorts: number; longForm: number }[] }) {
  const max = Math.max(1, ...weeks.map((w) => w.shorts + w.longForm));
  return (
    <div className="intel-bars" role="img" aria-label={`Uploads per week: ${weeks.map((w) => w.shorts + w.longForm).join(", ")}`}>
      {weeks.map((w) => (
        <div key={w.weekStart} className="intel-bar" title={`Week of ${w.weekStart}: ${w.shorts} Shorts, ${w.longForm} long-form`}>
          <span className="is-long" style={{ height: `${(w.longForm / max) * 100}%` }} />
          <span className="is-shorts" style={{ height: `${(w.shorts / max) * 100}%` }} />
        </div>
      ))}
    </div>
  );
}

export function VideoTable({
  videos,
  showChannel = false,
  compact = false,
}: {
  videos: (ScoredVideo & { channel?: { title: string; youtube_channel_id: string } })[];
  showChannel?: boolean;
  /** Just views and vs avg, for pages that already show a lot. */
  compact?: boolean;
}) {
  if (videos.length === 0) return <div className="dash-empty">No stored uploads in this period yet.</div>;
  return (
    <div className="table-wrap">
      <table className="intel-videos">
        <thead>
          <tr>
            <th>Video</th>
            <th className="num">Views</th>
            {compact ? null : (
              <>
                <th className="num">Likes</th>
                <th className="num">Comments</th>
                <th className="num">Views/hr</th>
              </>
            )}
            <th className="num" title="Views relative to the channel's normal performance">vs avg</th>
          </tr>
        </thead>
        <tbody>
          {videos.map((v) => (
            <tr key={v.id} data-breakout={(v.multiplier ?? 0) >= 3}>
              <td>
                <a
                  href={v.format === "short" ? `https://www.youtube.com/shorts/${v.youtube_video_id}` : `https://www.youtube.com/watch?v=${v.youtube_video_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="intel-video"
                >
                  <span className="intel-thumb" data-format={v.format}>
                    <img src={`https://i.ytimg.com/vi/${v.youtube_video_id}/mqdefault.jpg`} alt="" loading="lazy" />
                  </span>
                  <span className="intel-video-text">
                    <span className="intel-video-title">{v.title}</span>
                    <span className="intel-muted">
                      {showChannel && v.channel ? `${v.channel.title} · ` : ""}
                      {v.format === "short" ? "Short" : "Long-form"} · {timeAgo(v.published_at)}
                    </span>
                  </span>
                </a>
              </td>
              <td className="num">{formatCompact(v.view_count)}</td>
              {compact ? null : (
                <>
                  <td className="num">{formatCompact(v.like_count)}</td>
                  <td className="num">{formatCompact(v.comment_count)}</td>
                  <td className="num">{formatCompact(Math.round(v.vph))}</td>
                </>
              )}
              <td className="num">
                <Multiplier value={v.multiplier} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChannelCell({ channel, href }: { channel: { title: string; thumbnail_url: string | null; subscriber_count: number | null; hidden_subscriber_count?: boolean }; href?: string }) {
  const body = (
    <>
      {channel.thumbnail_url ? <img className="dash-avatar" src={channel.thumbnail_url} alt="" loading="lazy" /> : <span className="dash-avatar" />}
      <span className="dash-row-main">
        <span className="dash-row-title">{channel.title}</span>
        <span className="dash-row-sub">{channel.hidden_subscriber_count ? "Hidden" : formatCompact(channel.subscriber_count)} subs</span>
      </span>
    </>
  );
  return href ? (
    <Link href={href} className="intel-channel">
      {body}
    </Link>
  ) : (
    <span className="intel-channel">{body}</span>
  );
}

export const percent = (v: number | null, digits = 1) => formatPercent(v, digits);