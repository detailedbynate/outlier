import { computeVideoPerformance, type VideoPerformanceMetrics } from "@/lib/analytics/metrics";
import type { YouTubeService } from "@/lib/youtube/service";
import type { YouTubeChannel, YouTubeVideo } from "@/types/youtube";

export interface VideoAnalysis {
  video: YouTubeVideo;
  channel: YouTubeChannel;
  metrics: VideoPerformanceMetrics;
  /** How many of the channel's recent same-format videos formed the baseline. */
  baselineSampleSize: number;
  analyzedAt: string;
}

/** Video use cases. Analysis runs live against YouTube so it works for videos not yet in the catalog. */
export class VideoService {
  constructor(private readonly youtube: YouTubeService) {}

  getVideo(idOrUrl: string): Promise<YouTubeVideo> {
    return this.youtube.getVideo(idOrUrl);
  }

  /**
   * Score a single video against its channel's recent uploads of the same format.
   * Quota: ~4 units (video + channel + playlist page + video hydrate).
   */
  async analyzeVideo(idOrUrl: string, now: Date = new Date()): Promise<VideoAnalysis> {
    const video = await this.youtube.getVideo(idOrUrl);
    const filter = video.format === "short" ? "shorts" : "long_form";
    const [channel, recent] = await Promise.all([
      this.youtube.getChannel(video.channelId),
      this.youtube.getChannelVideos(video.channelId, { filter, maxResults: 30 }),
    ]);

    const baseline = recent.items.filter((v) => v.id !== video.id).map((v) => v.statistics.viewCount);
    const metrics = computeVideoPerformance(
      {
        viewCount: video.statistics.viewCount,
        likeCount: video.statistics.likeCount,
        commentCount: video.statistics.commentCount,
        publishedAt: video.publishedAt,
        channelRecentViewCounts: baseline,
      },
      now,
    );

    return { video, channel, metrics, baselineSampleSize: baseline.length, analyzedAt: now.toISOString() };
  }
}
