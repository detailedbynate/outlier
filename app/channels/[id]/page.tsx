/* eslint-disable @next/next/no-img-element -- YouTube images are already CDN-optimized */
import Link from "next/link";
import { notFound } from "next/navigation";
import { LineChart } from "@/components/line-chart";
import { StatTile } from "@/components/stat-tile";
import { VideoCard } from "@/components/video-card";
import { daysAgo, formatCompact, formatNumber, timeAgo } from "@/lib/format";
import { getServices } from "@/lib/services";
import { CHANNEL_ID_PATTERN } from "@/lib/youtube/parse";

export const dynamic = "force-dynamic";

export default async function ChannelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!CHANNEL_ID_PATTERN.test(id)) notFound();

  const { repositories } = getServices();
  const channel = await repositories.channels.findByYouTubeId(id);
  if (!channel) notFound();

  const [snapshots, videos] = await Promise.all([
    repositories.channels.listSnapshots(channel.id, daysAgo(365)),
    repositories.videos.feed({ orderBy: "published_at", limit: 50, youtubeChannelId: id }),
  ]);

  const topOutliers = videos
    .filter((v) => v.outlier_score !== null)
    .toSorted((a, b) => (b.outlier_score ?? 0) - (a.outlier_score ?? 0))
    .slice(0, 6);

  const first = snapshots[0];
  const last = snapshots.at(-1);
  const subGrowth =
    first && last && first !== last && first.subscriber_count !== null && last.subscriber_count !== null
      ? last.subscriber_count - first.subscriber_count
      : null;

  return (
    <div className="stack">
      <div className="row" style={{ gap: 16 }}>
        {channel.thumbnail_url ? <img className="avatar avatar-lg" src={channel.thumbnail_url} alt="" /> : null}
        <div>
          <h1>{channel.title}</h1>
          <div className="row muted">
            {channel.handle ? <span>{channel.handle}</span> : null}
            {channel.country ? <span>· {channel.country}</span> : null}
            <span>· synced {timeAgo(channel.last_synced_at)}</span>
            <a href={`https://www.youtube.com/channel/${channel.youtube_channel_id}`} target="_blank" rel="noreferrer">
              · Open on YouTube ↗
            </a>
          </div>
        </div>
      </div>

      <div className="grid grid-4">
        <StatTile
          label="Subscribers"
          value={channel.hidden_subscriber_count ? "Hidden" : formatCompact(channel.subscriber_count)}
          note={subGrowth !== null ? `${subGrowth >= 0 ? "+" : ""}${formatNumber(subGrowth)} since ${new Date(first!.captured_at).toLocaleDateString()}` : undefined}
        />
        <StatTile label="Total views" value={formatCompact(channel.view_count)} />
        <StatTile label="Videos" value={formatNumber(channel.video_count)} />
        <StatTile label="Snapshots" value={formatNumber(snapshots.length)} note="One per day, thinned to weekly after 30 days" />
      </div>

      <section className="card">
        <h2>Subscribers</h2>
        <LineChart
          label="Subscribers"
          points={snapshots.filter((s) => s.subscriber_count !== null).map((s) => ({ t: s.captured_at, value: s.subscriber_count! }))}
        />
      </section>

      <section>
        <h2>Biggest outliers</h2>
        {topOutliers.length === 0 ? (
          <div className="card empty">No performance data yet.</div>
        ) : (
          <div className="video-grid">
            {topOutliers.map((video) => (
              <VideoCard key={video.video_id} video={video} showChannel={false} />
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Recent uploads</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Video</th>
                <th className="num">Views</th>
                <th className="num">Views / day</th>
                <th className="num">Outlier</th>
                <th className="num">Published</th>
              </tr>
            </thead>
            <tbody>
              {videos.map((video) => (
                <tr key={video.video_id}>
                  <td>
                    <a href={`https://www.youtube.com/watch?v=${video.youtube_video_id}`} target="_blank" rel="noreferrer">
                      <span className="clamp">{video.title}</span>
                    </a>
                    <span className="badge">{video.format === "short" ? "Short" : video.format === "long_form" ? "Video" : video.format}</span>
                  </td>
                  <td className="num">{formatCompact(video.view_count)}</td>
                  <td className="num">{formatCompact(video.views_per_day)}</td>
                  <td className="num">{video.outlier_score === null ? "—" : `${video.outlier_score.toFixed(1)}×`}</td>
                  <td className="num muted">{timeAgo(video.published_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="muted">
        <Link href="/channels">← All channels</Link>
      </p>
    </div>
  );
}
