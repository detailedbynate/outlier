/* eslint-disable @next/next/no-img-element -- YouTube images are already CDN-optimized */
import { StatTile } from "@/components/stat-tile";
import { isAppError } from "@/lib/core/errors";
import { formatCompact, formatDuration, formatMultiplier, formatNumber, formatPercent, timeAgo } from "@/lib/format";
import { requireApprovedUser } from "@/lib/auth/session";
import { getServices } from "@/lib/services";
import type { VideoAnalysis } from "@/lib/services/video-service";

export const dynamic = "force-dynamic";

export default async function AnalyzePage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  await requireApprovedUser();
  const { v } = await searchParams;
  const input = v?.trim() ?? "";

  let analysis: VideoAnalysis | null = null;
  let error: string | null = null;
  if (input) {
    try {
      analysis = await getServices().videos.analyzeVideo(input);
    } catch (e) {
      error = isAppError(e) && e.expose ? e.message : "Could not analyze that video.";
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>Analyze a video</h1>
        <p className="subtitle">Paste any YouTube video or Short to see how it performs against its channel.</p>
      </div>

      <form className="card" method="get">
        <div className="form">
          <label htmlFor="v" className="sr-only">
            Video URL or ID
          </label>
          <input id="v" name="v" type="text" defaultValue={input} placeholder="https://www.youtube.com/watch?v=…" required />
          <button type="submit">Analyze</button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </form>

      {analysis ? <AnalysisResult analysis={analysis} /> : null}
    </div>
  );
}

function AnalysisResult({ analysis }: { analysis: VideoAnalysis }) {
  const { video, channel, metrics } = analysis;
  const verdict =
    metrics.outlierScore === null
      ? "Not enough channel history to compare."
      : metrics.outlierScore >= 3
        ? "Breakout — far above this channel's normal."
        : metrics.outlierScore >= 1.5
          ? "Above average for this channel."
          : metrics.outlierScore >= 0.7
            ? "Typical for this channel."
            : "Below this channel's usual performance.";

  return (
    <>
      <section className="card">
        <div className="row" style={{ alignItems: "flex-start", gap: 20 }}>
          {video.thumbnailUrl ? <img className="thumb" style={{ width: 280 }} src={video.thumbnailUrl} alt="" /> : null}
          <div style={{ flex: "1 1 300px" }}>
            <h2 style={{ fontSize: 18 }}>
              <a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noreferrer">
                {video.title}
              </a>
            </h2>
            <div className="row muted">
              <a href={`https://www.youtube.com/channel/${channel.id}`} target="_blank" rel="noreferrer">
                {channel.title}
              </a>
              <span>· {formatCompact(channel.statistics.subscriberCount)} subs</span>
              <span>· {timeAgo(video.publishedAt)}</span>
              <span>· {formatDuration(video.durationSeconds)}</span>
              <span className="badge">{video.format === "short" ? "Short" : video.format === "long_form" ? "Video" : video.format}</span>
            </div>
            <p style={{ marginTop: 16, fontSize: 16 }}>
              <strong>{formatMultiplier(metrics.outlierScore)}</strong> the channel&apos;s median views. {verdict}
            </p>
          </div>
        </div>
      </section>

      <div className="grid grid-4">
        <StatTile label="Views" value={formatCompact(video.statistics.viewCount)} note={formatNumber(video.statistics.viewCount)} />
        <StatTile label="Views per day" value={formatCompact(metrics.viewsPerDay)} />
        <StatTile
          label="Outlier score"
          value={formatMultiplier(metrics.outlierScore)}
          note={`vs median ${formatCompact(metrics.channelMedianViews)} across ${analysis.baselineSampleSize} recent ${video.format === "short" ? "Shorts" : "videos"}`}
        />
        <StatTile
          label="Engagement"
          value={formatPercent(metrics.engagementRate, 2)}
          note={`${formatCompact(video.statistics.likeCount)} likes · ${formatCompact(video.statistics.commentCount)} comments`}
        />
      </div>
    </>
  );
}
