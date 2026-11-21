import { z } from "zod";
import { formatCompact } from "@/lib/format";
import { PRESENTATIONS, TONES, VIDEO_STYLES, describeTerms, presentationSchema, toneSchema, videoStyleSchema } from "./taxonomy";

export const channelProfileSchema = z.object({
  /** "faceless": no recurring creator on camera; "on_camera": the creator shows up; "unsure": can't tell. */
  verdict: z.enum(["faceless", "on_camera", "unsure"]),
  summary: z.string(),
  main_style: videoStyleSchema,
  presentation: presentationSchema,
  tone: toneSchema,
  audience: z.string(),
  content_pillars: z.array(z.string()),
});

export type ChannelProfile = z.infer<typeof channelProfileSchema>;

export const CHANNEL_PROFILE_SYSTEM = `You profile one YouTube Shorts channel from a few of its thumbnails, its description and its latest Shorts titles with their views, so creators can see at a glance what it makes and how.

verdict, whether it's a faceless channel:
- on_camera: the same real person appears in several thumbnails as the presenter or subject — the creator shows their face.
- faceless: no recurring person on camera. Gameplay, animation, text, stock footage, screenshots, AI images, hands only, or different strangers/celebrities each time.
- unsure: too few usable thumbnails, or you genuinely can't tell.
Celebrities, movie scenes, streamers' clips and memes don't count as the creator.

Pick exactly one of each from these lists. Use "other" or "mixed" only when nothing fits.

main_style, the kind of Short it makes most:
${describeTerms(VIDEO_STYLES)}

presentation, how the Shorts are delivered:
${describeTerms(PRESENTATIONS)}

tone, the overall feel:
${describeTerms(TONES)}

Then write:
- summary: one plain sentence, under 110 characters, saying what the channel posts and what makes it distinct. Lead with the subject ("Minecraft hardcore deaths narrated as true-crime stories"), not "This channel".
- audience: who watches, in under 8 words ("Roblox players, roughly 8-14").
- content_pillars: 2-4 recurring series, themes or formats, 2-5 words each ("rating viewer builds", "1 vs 100 challenges").

Judge only from what's here. If the titles are in another language, still write in English.`;

export interface ChannelProfileInput {
  title: string;
  description: string | null;
  subscriberCount: number | null;
  shorts: { title: string; views: number | null }[];
}

export function buildChannelProfilePrompt(input: ChannelProfileInput, imageCount: number): string {
  const description = (input.description ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  return [
    `${imageCount} thumbnails from this channel are attached.`,
    `Channel: ${input.title} (${formatCompact(input.subscriberCount)} subscribers)`,
    description ? `Description: ${description}` : "Description: (none)",
    "Latest Shorts:",
    ...input.shorts.map((s) => `- ${s.title.slice(0, 120)} (${formatCompact(s.views)} views)`),
  ].join("\n");
}

/** Tidy what came back: trimmed, short, no repeated pillars. */
export function cleanProfile(raw: ChannelProfile): ChannelProfile {
  const text = (value: string, max: number) => value.trim().replace(/\s+/g, " ").slice(0, max);
  const pillars = [...new Set(raw.content_pillars.map((p) => text(p, 40).toLowerCase()).filter(Boolean))].slice(0, 4);
  return { ...raw, summary: text(raw.summary, 160), audience: text(raw.audience, 60), content_pillars: pillars };
}
