import { z } from "zod";

/**
 * Zod schemas for the subset of YouTube Data API v3 responses we consume.
 * Objects are non-strict so new API fields never break parsing; every field
 * YouTube may omit (private data, hidden counts, regional differences) is optional.
 */

const thumbnail = z.object({ url: z.string(), width: z.number().optional(), height: z.number().optional() });

export const thumbnailsSchema = z
  .object({
    default: thumbnail.optional(),
    medium: thumbnail.optional(),
    high: thumbnail.optional(),
    standard: thumbnail.optional(),
    maxres: thumbnail.optional(),
  })
  .partial();

export type RawThumbnails = z.infer<typeof thumbnailsSchema>;

const countString = z.union([z.string(), z.number()]).optional();

export const rawChannelSchema = z.object({
  id: z.string(),
  snippet: z
    .object({
      title: z.string(),
      description: z.string().optional(),
      customUrl: z.string().optional(),
      publishedAt: z.string().optional(),
      thumbnails: thumbnailsSchema.optional(),
      defaultLanguage: z.string().optional(),
      country: z.string().optional(),
    })
    .optional(),
  statistics: z
    .object({
      viewCount: countString,
      subscriberCount: countString,
      hiddenSubscriberCount: z.boolean().optional(),
      videoCount: countString,
    })
    .optional(),
  contentDetails: z
    .object({ relatedPlaylists: z.object({ uploads: z.string().optional() }).partial().optional() })
    .optional(),
  brandingSettings: z
    .object({
      channel: z.object({ keywords: z.string().optional(), country: z.string().optional() }).partial().optional(),
      image: z.object({ bannerExternalUrl: z.string().optional() }).partial().optional(),
    })
    .optional(),
  topicDetails: z.object({ topicCategories: z.array(z.string()).optional() }).optional(),
  status: z.object({ madeForKids: z.boolean().optional() }).partial().optional(),
});

export const rawVideoSchema = z.object({
  id: z.string(),
  snippet: z
    .object({
      publishedAt: z.string(),
      channelId: z.string(),
      channelTitle: z.string().optional(),
      title: z.string(),
      description: z.string().optional(),
      thumbnails: thumbnailsSchema.optional(),
      tags: z.array(z.string()).optional(),
      categoryId: z.string().optional(),
      liveBroadcastContent: z.string().optional(),
      defaultLanguage: z.string().optional(),
      defaultAudioLanguage: z.string().optional(),
    })
    .optional(),
  contentDetails: z
    .object({
      duration: z.string().optional(),
      definition: z.string().optional(),
      caption: z.string().optional(),
    })
    .partial()
    .optional(),
  statistics: z
    .object({ viewCount: countString, likeCount: countString, commentCount: countString })
    .partial()
    .optional(),
  status: z.object({ privacyStatus: z.string().optional(), madeForKids: z.boolean().optional() }).partial().optional(),
  topicDetails: z.object({ topicCategories: z.array(z.string()).optional() }).optional(),
  liveStreamingDetails: z
    .object({ actualStartTime: z.string().optional(), actualEndTime: z.string().optional(), scheduledStartTime: z.string().optional() })
    .partial()
    .optional(),
});

export const rawPlaylistSchema = z.object({
  id: z.string(),
  snippet: z
    .object({
      publishedAt: z.string().optional(),
      channelId: z.string(),
      channelTitle: z.string().optional(),
      title: z.string(),
      description: z.string().optional(),
      thumbnails: thumbnailsSchema.optional(),
    })
    .optional(),
  contentDetails: z.object({ itemCount: z.number().optional() }).optional(),
  status: z.object({ privacyStatus: z.string().optional() }).optional(),
});

export const rawPlaylistItemSchema = z.object({
  id: z.string(),
  snippet: z
    .object({
      publishedAt: z.string().optional(),
      title: z.string().optional(),
      playlistId: z.string().optional(),
      position: z.number().optional(),
      resourceId: z.object({ videoId: z.string().optional() }).optional(),
    })
    .optional(),
  contentDetails: z.object({ videoId: z.string().optional(), videoPublishedAt: z.string().optional() }).optional(),
});

export const rawSearchResultSchema = z.object({
  id: z.object({
    kind: z.string(),
    videoId: z.string().optional(),
    channelId: z.string().optional(),
    playlistId: z.string().optional(),
  }),
  snippet: z
    .object({
      publishedAt: z.string().optional(),
      channelId: z.string().optional(),
      channelTitle: z.string().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      thumbnails: thumbnailsSchema.optional(),
      liveBroadcastContent: z.string().optional(),
    })
    .optional(),
});

export const rawVideoCategorySchema = z.object({
  id: z.string(),
  snippet: z.object({ title: z.string(), assignable: z.boolean().optional() }).optional(),
});

/** Every list endpoint shares this envelope. */
export function listResponseSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item).default([]),
    nextPageToken: z.string().optional(),
    prevPageToken: z.string().optional(),
    pageInfo: z.object({ totalResults: z.number().optional(), resultsPerPage: z.number().optional() }).optional(),
  });
}

export type RawChannel = z.infer<typeof rawChannelSchema>;
export type RawVideo = z.infer<typeof rawVideoSchema>;
export type RawPlaylist = z.infer<typeof rawPlaylistSchema>;
export type RawPlaylistItem = z.infer<typeof rawPlaylistItemSchema>;
export type RawSearchResult = z.infer<typeof rawSearchResultSchema>;
export type RawVideoCategory = z.infer<typeof rawVideoCategorySchema>;

export const youtubeErrorBodySchema = z.object({
  error: z.object({
    code: z.number().optional(),
    message: z.string().optional(),
    errors: z.array(z.object({ reason: z.string().optional(), domain: z.string().optional() })).optional(),
  }),
});
