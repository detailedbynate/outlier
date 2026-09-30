import { computeVideoPerformance, type VideoPerformanceMetrics } from "@/lib/analytics/metrics";
import { videoInsights, type VideoInsights } from "@/lib/analytics/video-insights";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { TranscriptRepository } from "@/lib/database/repositories/transcripts";
import type { VideoRepository } from "@/lib/database/repositories/videos";
import { openingLine } from "@/lib/innertube/transcripts";
import { transcriptToText, type TranscriptProvider } from "@/lib/youtube/transcripts";
import type { YouTubeService } from "@/lib/youtube/service";
import type { YouTubeChannel, YouTubeVideo } from "@/types/youtube";

export interface VideoAnalysis {
  video: YouTubeVideo;
  channel: YouTubeChannel;
  metrics: VideoPerformanceMetrics;
  /** How many of the channel's recent same-format videos formed the baseline. */
  baselineSampleSize: number;
  /** Those recent uploads (this video excluded), newest first. */
  peers: YouTubeVideo[];
  insights: VideoInsights;
  /** Stored view counts over time, oldest first; empty when Outlier hasn't been tracking the video. */
  history: { t: string; views: number }[];
  /** What the video says, when there's a transcript to read. */
  hook: { opening: string; words: number; wordsPerSecond: number | null } | null;
  analyzedAt: string;
}

export interface VideoServiceDeps {
  /** Stored rows, for view history and transcripts. Without them the analysis is YouTube-only. */
  videos?: Pick<VideoRepository, "findByYouTubeId" | "listSnapshots"> | null;
  transcripts?: Pick<TranscriptRepository, "get" | "save" | "markUnavailable"> | null;
  /** Reads a transcript when none is stored. Null wherever scraping is off. */
  reader?: TranscriptProvider | null;
  logger?: Logger;
}

/** A live read is a scrape slot; past this, the page goes ahead without the hook. */
const TRANSCRIPT_TIMEOUT_MS = 6_000;
const OPENING_SECONDS = 3;

/** Video use cases. Analysis runs live against YouTube so it works for videos not yet in the catalog. */
export class VideoService {
  private readonly log: Logger;

  constructor(
    private readonly youtube: YouTubeService,
    private readonly deps: VideoServiceDeps = {},
  ) {
    this.log = deps.logger ?? createLogger({ module: "services.videos" });
  }

  getVideo(idOrUrl: string): Promise<YouTubeVideo> {
    return this.youtube.getVideo(idOrUrl);
  }

  /**
   * Score a single video against its channel's recent uploads of the same format,
   * and say what stands out. Quota: ~4 units (video + channel + playlist page +
   * video hydrate); history and the hook come from stored data or a scrape.
   */
  async analyzeVideo(idOrUrl: string, now: Date = new Date()): Promise<VideoAnalysis> {
    const video = await this.youtube.getVideo(idOrUrl);
    const filter = video.format === "short" ? "shorts" : "long_form";
    const [channel, recent, stored] = await Promise.all([
      this.youtube.getChannel(video.channelId),
      this.youtube.getChannelVideos(video.channelId, { filter, maxResults: 30 }),
      this.storedRow(video.id),
    ]);

    const peers = recent.items.filter((v) => v.id !== video.id);
    const [snapshots, hook] = await Promise.all([this.snapshots(stored?.id ?? null), this.hook(video, stored?.id ?? null)]);
    const metrics = computeVideoPerformance(
      {
        viewCount: video.statistics.viewCount,
        likeCount: video.statistics.likeCount,
        commentCount: video.statistics.commentCount,
        publishedAt: video.publishedAt,
        channelRecentViewCounts: peers.map((v) => v.statistics.viewCount),
        viewSnapshots: snapshots.map((s) => ({ capturedAt: s.t, value: s.views })),
      },
      now,
    );
    const insights = videoInsights(video, channel.statistics.subscriberCount, peers, { last24h: metrics.viewsDelta24h, last7d: metrics.viewsDelta7d }, now);

    return { video, channel, metrics, baselineSampleSize: peers.length, peers, insights, history: snapshots, hook, analyzedAt: now.toISOString() };
  }

  private async storedRow(youtubeVideoId: string): Promise<{ id: string } | null> {
    if (!this.deps.videos) return null;
    try {
      return await this.deps.videos.findByYouTubeId(youtubeVideoId);
    } catch (error) {
      this.log.warn("stored video lookup failed", { youtubeVideoId, error });
      return null;
    }
  }

  private async snapshots(videoId: string | null): Promise<{ t: string; views: number }[]> {
    if (!videoId || !this.deps.videos) return [];
    try {
      const rows = await this.deps.videos.listSnapshots(videoId);
      return rows.map((r) => ({ t: r.captured_at, views: Number(r.view_count) }));
    } catch (error) {
      this.log.warn("video history lookup failed", { videoId, error });
      return [];
    }
  }

  /**
   * The opening words. A stored transcript first; otherwise one live read with a
   * time limit, kept for next time when the video is in the catalog.
   */
  private async hook(video: YouTubeVideo, storedId: string | null): Promise<VideoAnalysis["hook"]> {
    const pace = (words: number) => (video.durationSeconds && video.durationSeconds > 0 ? Math.round((words / video.durationSeconds) * 10) / 10 : null);
    try {
      if (storedId && this.deps.transcripts) {
        const row = await this.deps.transcripts.get(storedId);
        if (row) return row.word_count > 0 && row.opening ? { opening: row.opening, words: row.word_count, wordsPerSecond: pace(row.word_count) } : null;
      }
      if (!this.deps.reader) return null;
      const transcript = await Promise.race([
        this.deps.reader.getTranscript(video.id),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), TRANSCRIPT_TIMEOUT_MS)),
      ]);
      if (!transcript || transcript.segments.length === 0) return null;
      if (storedId && this.deps.transcripts) await this.deps.transcripts.save(storedId, transcript, OPENING_SECONDS).catch(() => undefined);
      const words = transcriptToText(transcript).split(/\s+/).filter(Boolean).length;
      const opening = openingLine(transcript, OPENING_SECONDS);
      return opening ? { opening, words, wordsPerSecond: pace(words) } : null;
    } catch (error) {
      // Most Shorts have no captions at all; that's not worth more than a debug line.
      this.log.debug("no hook for video", { videoId: video.id, error });
      return null;
    }
  }
}
