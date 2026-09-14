import { z } from "zod";
import { parseChannelIdentifier } from "@/lib/youtube/parse";

/**
 * Onboarding answers. Shared by the client (instant feedback) and the server
 * (authoritative validation), so both always agree.
 */

export const GOALS = [
  { value: "grow_channel", label: "Grow my YouTube channel", description: "Find what works in your space and do more of it" },
  { value: "find_viral_videos", label: "Find viral videos", description: "Spot videos beating their channel's normal views" },
  { value: "research_competitors", label: "Research competitors", description: "Keep tabs on channels you're up against" },
  { value: "find_niches", label: "Find profitable niches", description: "Discover spaces where small channels win" },
  { value: "content_ideas", label: "Generate content ideas", description: "Turn breakout formats into your next upload" },
  { value: "analyze_videos", label: "Analyze videos", description: "Understand why a video took off" },
] as const;

export const CONTENT_FORMATS = [
  { value: "shorts", label: "Shorts", description: "Vertical videos under 3 minutes" },
  { value: "long_form", label: "Long-form", description: "Regular horizontal videos" },
] as const;

export const NICHE_SUGGESTIONS = [
  "Gaming",
  "AI",
  "Finance",
  "Fitness",
  "Commentary",
  "Tech",
  "Cooking",
  "Comedy",
  "Education",
  "Beauty",
  "Travel",
  "Cars",
  "Pets",
  "Sports",
  "Music",
  "Motivation",
  "History",
  "True crime",
  "DIY",
  "Minecraft",
  "Productivity",
  "Crypto",
  "Fashion",
  "Parenting",
] as const;

export const MAX_NICHES = 10;
export const MAX_COMPETITORS = 10;

export type GoalValue = (typeof GOALS)[number]["value"];
export type ContentFormatValue = (typeof CONTENT_FORMATS)[number]["value"];

const goalValues = GOALS.map((g) => g.value) as [GoalValue, ...GoalValue[]];
const formatValues = CONTENT_FORMATS.map((f) => f.value) as [ContentFormatValue, ...ContentFormatValue[]];

/** A YouTube channel id, @handle, or channel URL. Stored trimmed as entered. */
export const channelReferenceSchema = z
  .string()
  .trim()
  .min(1, "Enter a channel URL or @handle.")
  .max(300, "That link is too long.")
  .refine(
    (value) => {
      try {
        parseChannelIdentifier(value);
        return true;
      } catch {
        return false;
      }
    },
    { message: "Use a YouTube channel link, @handle, or channel ID." },
  );

export const nicheSchema = z
  .string()
  .trim()
  .min(2, "Niches need at least 2 characters.")
  .max(40, "Keep niches under 40 characters.")
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} &'+./-]*$/u, "Use letters, numbers, and simple punctuation.");

/** Case-insensitive de-duplication that keeps the first spelling. */
function uniqueCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const onboardingSchema = z
  .object({
    goals: z.array(z.enum(goalValues)).min(1, "Pick at least one goal.").max(goalValues.length),
    contentFormats: z.array(z.enum(formatValues)).min(1, "Pick at least one content type.").max(formatValues.length),
    niches: z.array(nicheSchema).max(MAX_NICHES, `Pick up to ${MAX_NICHES} niches.`).transform(uniqueCaseInsensitive),
    hasChannel: z.boolean(),
    channel: z.string().trim().max(300).optional().nullable(),
    competitors: z
      .array(channelReferenceSchema)
      .max(MAX_COMPETITORS, `Add up to ${MAX_COMPETITORS} channels.`)
      .transform(uniqueCaseInsensitive),
  })
  .superRefine((value, ctx) => {
    if (!value.hasChannel) return;
    const result = channelReferenceSchema.safeParse(value.channel ?? "");
    if (!result.success) {
      ctx.addIssue({ code: "custom", path: ["channel"], message: result.error.issues[0]?.message ?? "Enter your channel." });
    }
  })
  .transform((value) => ({
    ...value,
    goals: [...new Set(value.goals)],
    contentFormats: [...new Set(value.contentFormats)],
    channel: value.hasChannel ? (value.channel?.trim() ?? null) : null,
  }));

export type OnboardingInput = z.input<typeof onboardingSchema>;
export type OnboardingAnswers = z.output<typeof onboardingSchema>;
