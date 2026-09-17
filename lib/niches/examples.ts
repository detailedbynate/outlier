/**
 * Proof for a niche: uploads from smaller channels that beat their size, and
 * the creators behind them.
 */

import type { NicheChannel, NicheVideo } from "./analysis";

/** A Short that shows what's working in a niche. */
export interface NicheExample {
  youtubeVideoId: string;
  title: string;
  channelTitle: string;
  views: number;
  subscribers: number | null;
  publishedAt: string;
}

/** A smaller creator doing well in a niche. */
export interface NicheCreator {
  youtubeChannelId: string;
  title: string;
  thumbnailUrl: string | null;
  subscribers: number | null;
  avgViews: number;
}

const EXAMPLE_MAX_SUBS = 250_000;

/** Uploads that beat their channel's size by the most: proof a newcomer can do it. */
export function examplesFor(videos: readonly NicheVideo[], channels: ReadonlyMap<string, NicheChannel>, limit = 3): NicheExample[] {
  const ranked = videos
    .map((video) => {
      const channel = channels.get(video.channel_id);
      const subscribers = channel?.subscriber_count ?? null;
      return { video, channel, subscribers, lift: video.view_count / Math.max(subscribers ?? 0, 1_000) };
    })
    .filter((v) => v.channel && (v.subscribers === null || v.subscribers < EXAMPLE_MAX_SUBS))
    .sort((a, b) => b.lift - a.lift || b.video.view_count - a.video.view_count);

  const seen = new Set<string>();
  const examples: NicheExample[] = [];
  for (const { video, channel, subscribers } of ranked) {
    if (examples.length >= limit || seen.has(video.channel_id)) continue;
    seen.add(video.channel_id);
    examples.push({
      youtubeVideoId: video.youtube_video_id,
      title: video.title,
      channelTitle: channel!.title,
      views: video.view_count,
      subscribers,
      publishedAt: video.published_at,
    });
  }
  return examples;
}

export function creatorsFor(videos: readonly NicheVideo[], channels: ReadonlyMap<string, NicheChannel>, limit = 4): NicheCreator[] {
  const byChannel = new Map<string, { views: number; count: number }>();
  for (const video of videos) {
    const entry = byChannel.get(video.channel_id) ?? { views: 0, count: 0 };
    entry.views += video.view_count;
    entry.count += 1;
    byChannel.set(video.channel_id, entry);
  }
  return [...byChannel.entries()]
    .flatMap(([id, entry]) => {
      const channel = channels.get(id);
      if (!channel || (channel.subscriber_count !== null && channel.subscriber_count >= EXAMPLE_MAX_SUBS)) return [];
      return [
        {
          youtubeChannelId: channel.youtube_channel_id,
          title: channel.title,
          thumbnailUrl: channel.thumbnail_url,
          subscribers: channel.subscriber_count,
          avgViews: Math.round(entry.views / entry.count),
        },
      ];
    })
    .sort((a, b) => b.avgViews - a.avgViews)
    .slice(0, limit);
}
