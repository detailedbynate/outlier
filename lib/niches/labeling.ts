/**
 * Channel niche labeling: turns what a channel posts into a category, one
 * canonical game or topic, and a few specific sub-niches. The model sees a
 * compact summary of the channel; everything it returns is normalized here
 * before it touches the database.
 */

import { z } from "zod";

export const NICHE_CATEGORIES = [
  "Gaming",
  "Comedy & Skits",
  "Entertainment & Pop Culture",
  "Education & Explainers",
  "Science & Tech",
  "Finance & Business",
  "Food & Cooking",
  "Fitness & Health",
  "Beauty & Fashion",
  "Lifestyle & Vlogs",
  "Sports",
  "Music & Dance",
  "Animals & Pets",
  "Travel & Outdoors",
  "DIY, Crafts & Home",
  "Cars & Vehicles",
  "Art & Animation",
  "News & Commentary",
  "Relationships & Social",
  "Kids & Family",
  "Motivation & Self-Improvement",
  "ASMR & Satisfying",
  "Other",
] as const;

export const CONTENT_FORMATS = [
  "gameplay",
  "tutorial_guide",
  "tier_list_ranking",
  "commentary",
  "reaction",
  "skit_story",
  "compilation_clips",
  "facts_explainer",
  "challenge",
  "review",
  "animation",
  "vlog",
  "news_update",
  "meme_edit",
  "satisfying_asmr",
  "podcast_interview",
  "other",
] as const;

export const QUALITY_FLAGS = [
  // Mostly posts other people's footage.
  "reupload",
  // Stitched clips with little original work.
  "compilation",
  "made_for_kids",
  "ai_generated",
  "non_english",
  "spam_or_misleading",
] as const;

export type NicheCategory = (typeof NICHE_CATEGORIES)[number];
export type ContentFormat = (typeof CONTENT_FORMATS)[number];
export type QualityFlag = (typeof QUALITY_FLAGS)[number];

/** What the model returns for one channel. Ranges are enforced after parsing. */
export const channelLabelSchema = z.object({
  ref: z.string(),
  category: z.enum(NICHE_CATEGORIES),
  primary_kind: z.enum(["game", "topic"]),
  primary_name: z.string(),
  aliases: z.array(z.string()),
  sub_niches: z.array(z.string()),
  formats: z.array(z.enum(CONTENT_FORMATS)),
  flags: z.array(z.enum(QUALITY_FLAGS)),
  confidence: z.number(),
});

export const labelBatchSchema = z.object({ channels: z.array(channelLabelSchema) });

export type RawChannelLabel = z.infer<typeof channelLabelSchema>;

export interface ChannelLabelInput {
  ref: string;
  title: string;
  description: string | null;
  keywords: string[];
  topicCategories: string[];
  subscriberCount: number | null;
  recentTitles: string[];
  recentTags: string[];
}

export interface ChannelLabel {
  category: NicheCategory;
  primary: { kind: "game" | "topic"; name: string; slug: string; aliases: string[] };
  subNiches: string[];
  formats: ContentFormat[];
  flags: QualityFlag[];
  confidence: number;
}

export const LABEL_SYSTEM_PROMPT = `You label YouTube channels for Outlier, a research tool that helps creators find underrated niches and copy what works in them.

For each channel you get its name, description, keywords, YouTube topic categories, and recent upload titles and tags. Label what the channel actually posts now, judged mostly from the recent uploads.

Return one entry per channel, using the channel's ref exactly as given.

- category: the single best broad category from the allowed list.
- primary_kind and primary_name: the one thing the channel is about. For gaming channels this is the specific game, written as its official title ("My Singing Monsters", "Clash Royale", "Geometry Dash"). If a channel covers many games equally, use the genre instead ("Mobile Strategy Games", "Horror Games") with kind "topic". For everything else it is the specific topic ("Sourdough Baking", "Budget Travel in Japan", "Dog Training"), not the category restated.
- aliases: other names people search for the primary: abbreviations, hashtags written as words, common misspellings ("MSM", "clashroyale"). Leave it empty if there are none.
- sub_niches: one to five specific angles the channel works, narrow enough to be a niche on their own ("Clash Royale deck guides", "MSM breeding combos", "air fryer dinners"). Lowercase is fine. Don't repeat the primary name alone.
- formats: the content formats the channel uses most, one to three.
- flags: only flags that clearly apply. "reupload" means most videos are other people's footage; "compilation" means stitched clips with little original work; "non_english" means the uploads are mainly not in English.
- confidence: 0 to 1, how sure you are of primary_name. Use below 0.5 when recent uploads are too few or too mixed to tell.

Keep names consistent across channels: the same game or topic always gets the same primary_name.`;

const clean = (value: string, max: number) => value.replace(/\s+/g, " ").trim().slice(0, max);

/** A compact, stable summary of the batch for the model. */
export function buildLabelPrompt(channels: ChannelLabelInput[]): string {
  const blocks = channels.map((channel) => {
    const lines = [
      `ref: ${channel.ref}`,
      `name: ${clean(channel.title, 100)}`,
      channel.subscriberCount !== null ? `subscribers: ${channel.subscriberCount}` : null,
      channel.description ? `description: ${clean(channel.description, 400)}` : null,
      channel.keywords.length ? `keywords: ${channel.keywords.slice(0, 15).map((k) => clean(k, 40)).join(", ")}` : null,
      channel.topicCategories.length ? `youtube topics: ${channel.topicCategories.map(topicName).join(", ")}` : null,
      channel.recentTitles.length ? `recent uploads:\n${channel.recentTitles.slice(0, 12).map((t) => `  - ${clean(t, 120)}`).join("\n")}` : "recent uploads: none stored",
      channel.recentTags.length ? `common tags: ${channel.recentTags.slice(0, 20).map((t) => clean(t, 40)).join(", ")}` : null,
    ];
    return lines.filter(Boolean).join("\n");
  });
  return `Label these ${channels.length} channels.\n\n${blocks.join("\n\n---\n\n")}`;
}

/** "https://en.wikipedia.org/wiki/Action-adventure_game" -> "Action-adventure game" */
export function topicName(url: string): string {
  const last = url.split("/").pop() ?? url;
  try {
    return decodeURIComponent(last).replace(/_/g, " ");
  } catch {
    return last.replace(/_/g, " ");
  }
}

/** Slug in the niches table's format: lowercase words joined by single hyphens. */
export function nicheSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

const unique = <T>(values: T[]) => [...new Set(values)];

/** Validate ranges and tidy names. Returns null when the label is unusable. */
export function normalizeLabel(raw: RawChannelLabel): ChannelLabel | null {
  const name = clean(raw.primary_name, 80);
  const slug = nicheSlug(name);
  if (!name || slug.length < 2) return null;

  const aliases = unique(raw.aliases.map((a) => clean(a, 60).toLowerCase()).filter((a) => a.length >= 2 && a !== name.toLowerCase())).slice(0, 10);
  const subNiches = unique(raw.sub_niches.map((s) => clean(s, 60).toLowerCase()).filter((s) => s.length >= 3 && s !== name.toLowerCase())).slice(0, 5);

  return {
    category: raw.category,
    primary: { kind: raw.primary_kind, name, slug, aliases },
    subNiches,
    formats: unique(raw.formats).slice(0, 3),
    flags: unique(raw.flags),
    confidence: Math.round(Math.min(Math.max(Number.isFinite(raw.confidence) ? raw.confidence : 0, 0), 1) * 100) / 100,
  };
}
