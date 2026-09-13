import Link from "next/link";
import { StatTile } from "@/components/stat-tile";
import { StorageMeter } from "@/components/storage-meter";
import { TrackChannelForm } from "@/components/track-channel-form";
import { VideoCard } from "@/components/video-card";
import { daysAgo, formatNumber } from "@/lib/format";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { storage, repositories } = getServices();
  const [status, channelCount, videoCount, topVideos] = await Promise.all([
    storage.getStatus(),
    repositories.channels.count(),
    repositories.videos.count(),
    repositories.videos.feed({ orderBy: "outlier_score", limit: 6, publishedAfter: daysAgo(30) }),
  ]);

  return (
    <div className="stack">
      <div>
        <h1>Dashboard</h1>
        <p className="subtitle">Track channels and spot videos that outperform their channel.</p>
      </div>

      <div className="grid grid-4">
        <StatTile label="Tracked channels" value={formatNumber(channelCount)} note="Refreshed daily by the worker" />
        <StatTile label="Videos in catalog" value={formatNumber(videoCount)} note="Latest 50 uploads per channel" />
        <StorageMeter status={status} />
      </div>

      <section className="card">
        <h2>Track a channel</h2>
        <TrackChannelForm />
      </section>

      <section>
        <div className="spread">
          <h2>Top outliers · last 30 days</h2>
          <Link href="/viral" className="muted">
            See all →
          </Link>
        </div>
        {topVideos.length === 0 ? (
          <div className="card empty">Track a few channels to see their breakout videos here.</div>
        ) : (
          <div className="video-grid">
            {topVideos.map((video) => (
              <VideoCard key={video.video_id} video={video} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
