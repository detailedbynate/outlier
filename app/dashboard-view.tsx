import Link from "next/link";
import { GridIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { StorageMeter } from "@/components/storage-meter";
import { TrackChannelForm } from "@/components/track-channel-form";
import { VideoCard } from "@/components/video-card";
import { daysAgo, formatNumber } from "@/lib/format";
import { getServices } from "@/lib/services";

/** Signed-in home. Callers must check access first. */
export async function DashboardView({ userId }: { userId: string }) {
  const { storage, repositories, onboarding } = getServices();
  const [preferences, status, channelCount, videoCount, topVideos] = await Promise.all([
    onboarding.getPreferences(userId),
    storage.getStatus(),
    repositories.channels.count({ tracked: true }),
    repositories.videos.count(),
    repositories.videos.feed({ orderBy: "outlier_score", limit: 6, publishedAfter: daysAgo(30) }),
  ]);

  return (
    <div className="stack">
      <PageHeader icon={GridIcon} title="Dashboard" subtitle="Track channels and spot videos that outperform their channel." />

      <div className="grid grid-4">
        <StatTile label="Tracked channels" value={formatNumber(channelCount)} note="Refreshed daily" />
        <StatTile label="Videos in catalog" value={formatNumber(videoCount)} note="Latest uploads per channel" />
        <StorageMeter status={status} />
      </div>

      {preferences ? (
        <section className="card personalize-card">
          <div className="spread" style={{ alignItems: "center" }}>
            <div>
              <h2 style={{ marginBottom: 4 }}>Your preferences</h2>
              <p className="stat-note" style={{ margin: 0 }}>
                {preferences.contentFormats.map((f) => (f === "shorts" ? "Shorts" : "Long-form")).join(" + ") || "All formats"}
                {preferences.channel ? ` · ${preferences.channel}` : ""}
              </p>
            </div>
            <Link href="/settings/preferences" className="button-ghost">
              Edit preferences
            </Link>
          </div>
          {preferences.niches.length > 0 ? (
            <div className="chips" style={{ marginTop: 14 }}>
              {preferences.niches.map((niche) => (
                <Link key={niche} href={`/research/shorts-channels?q=${encodeURIComponent(niche)}`} className="chip">
                  {niche} →
                </Link>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

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
