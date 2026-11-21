import { z } from "zod";
import { formatCompact, formatMultiplier } from "@/lib/format";
import type { VideoFeedRow } from "@/types/database";
import { ANGLES, HOOK_TYPES, VIDEO_STYLES, angleSchema, describeTerms, hookTypeSchema, videoStyleSchema } from "./taxonomy";

export const videoBreakdownSchema = z.object({
  hook_type: hookTypeSchema,
  style: videoStyleSchema,
  angle: angleSchema,
  /** What it's about, specific: "Minecraft hardcore deaths", not "gaming". */
  topic: z.string(),
  /** The title as a reusable template, e.g. "I tried [thing] for [N] days". */
  title_pattern: z.string(),
  thumbnail_style: z.string(),
  why_it_worked: z.string(),
  how_to_copy: z.string(),
  tags: z.array(z.string()),
});

export type VideoBreakdown = z.infer<typeof videoBreakdownSchema>;

export const VIDEO_BREAKDOWN_SYSTEM = `You explain why a YouTube video beat its channel's usual views by a wide margin, for creators who want to make the next one. You see its thumbnail, title and numbers.

Pick exactly one of each from these lists. Use "other" only when nothing fits.

hook_type, how the first seconds grab a scrolling viewer:
${describeTerms(HOOK_TYPES)}

style, what kind of video it is:
${describeTerms(VIDEO_STYLES)}

angle, the feeling that makes people watch to the end and share:
${describeTerms(ANGLES)}

Then write:
- topic: what it's about in 2-6 words, specific enough to search for ("Roblox obby fails", not "gaming").
- title_pattern: the title turned into a reusable template, with the swappable parts in [brackets]. Keep the original wording around them.
- thumbnail_style: what the thumbnail does in under 12 words ("big red arrow on a cracked phone screen").
- why_it_worked: 2-3 short sentences on the specific reasons this one took off, grounded in the title, thumbnail and numbers. Name the concrete thing, not general advice.
- how_to_copy: 1-2 sentences a creator in this niche could act on today.
- tags: 3-6 lowercase descriptive tags (game, subject, format details), no #.

You can't watch the video, only judge from what's here. Don't invent what happens in it; say "likely" when inferring. Plain words, no hype.`;

/** The numbers and title Claude judges from; the thumbnail goes alongside as an image. */
export function buildVideoBreakdownPrompt(video: Pick<VideoFeedRow, "title" | "channel_title" | "subscriber_count" | "view_count" | "views_per_day" | "outlier_score" | "format" | "duration_seconds" | "published_at" | "like_count" | "comment_count">): string {
  const lines = [
    `Title: ${video.title}`,
    `Channel: ${video.channel_title} (${formatCompact(video.subscriber_count)} subscribers)`,
    `Format: ${video.format === "short" ? "YouTube Short" : "long-form video"}${video.duration_seconds ? `, ${video.duration_seconds}s` : ""}`,
    `Views: ${formatCompact(video.view_count)} (${formatMultiplier(video.outlier_score)} the channel's usual), ${formatCompact(video.views_per_day)} a day`,
    video.like_count !== null ? `Likes: ${formatCompact(video.like_count)}${video.comment_count !== null ? `, comments: ${formatCompact(video.comment_count)}` : ""}` : null,
    `Published: ${video.published_at.slice(0, 10)}`,
  ];
  return lines.filter(Boolean).join("\n");
}

/** Tidy what came back: trimmed text, short lowercase tags, no repeats. */
export function cleanBreakdown(raw: VideoBreakdown): VideoBreakdown {
  const text = (value: string, max: number) => value.trim().replace(/\s+/g, " ").slice(0, max);
  const tags = [...new Set(raw.tags.map((t) => t.trim().replace(/^#/, "").toLowerCase()).filter((t) => t.length > 0 && t.length <= 40))].slice(0, 6);
  return {
    ...raw,
    topic: text(raw.topic, 80),
    title_pattern: text(raw.title_pattern, 160),
    thumbnail_style: text(raw.thumbnail_style, 120),
    why_it_worked: text(raw.why_it_worked, 600),
    how_to_copy: text(raw.how_to_copy, 400),
    tags,
  };
}
