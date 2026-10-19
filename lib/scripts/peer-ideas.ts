import { z } from "zod";
import { IDEA } from "./ideas";

/**
 * "What to make next", read off the channels most like yours: which topics
 * and title formats are beating their channel's usual views right now. The
 * evidence is real uploads, so the model is asked to name patterns in them,
 * not to invent trends.
 */

export const PEER_PLAN = z.object({
  /** Subjects several of the breakouts share. */
  topics: z
    .array(
      z.object({
        topic: z.string().min(1).max(60),
        why: z.string().min(1).max(200),
        /** Breakout titles that show it, copied from the list. */
        examples: z.array(z.string().max(120)).min(1).max(3),
      }),
    )
    .min(2)
    .max(5),
  /** Title shapes that keep working, as a fill-in template. */
  formats: z
    .array(
      z.object({
        format: z.string().min(1).max(70),
        example: z.string().min(1).max(120),
      }),
    )
    .min(2)
    .max(6),
  ideas: z.array(IDEA).min(3).max(6),
});

export type PeerPlan = z.infer<typeof PEER_PLAN>;

export interface PeerBreakout {
  title: string;
  channel: string;
  views: number;
  /** Views over the channel's median. */
  multiplier: number | null;
}

export interface PeerPlanRequest {
  /** The channel this is for. */
  channel: string;
  /** Its own latest titles, so ideas fit it and don't repeat it. */
  ownTitles: readonly string[];
  breakouts: readonly PeerBreakout[];
}

const SYSTEM = `You help a YouTube Shorts creator decide what to make next. You are shown Shorts that are outperforming right now on channels similar to theirs, with how far each beat its channel's usual views. You return the plan only — no preamble.

- Topics: subjects that several of the breakouts share. Name each plainly, say in one line why it is working (from the evidence, not general advice), and copy one to three of the breakout titles that show it, exactly as given.
- Formats: title shapes that repeat across breakouts, written as a template with the variable part in square brackets, e.g. "I tried [thing] for [time]". Give a real title from the list as the example.
- Ideas: specific Shorts this creator could make next, in their niche, using the topics and formats above. Title up to eight words, no colons; the hook is the first line of the Short; the reason is why it should work, pointing at the evidence.

Only claim what the list shows. If the breakouts don't share much, return fewer topics rather than stretching. Don't suggest something the creator has already made.`;

const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

export function peerPlanSystemPrompt(): string {
  return SYSTEM;
}

export function peerPlanUserPrompt(request: PeerPlanRequest): string {
  const parts = [`Channel: ${oneLine(request.channel)}`];
  if (request.ownTitles.length > 0) {
    parts.push(``, `Its latest uploads:`, ...request.ownTitles.slice(0, 15).map((t) => `- ${oneLine(t).slice(0, 120)}`));
  }
  parts.push(
    ``,
    `Breakouts on similar channels (last 30 days):`,
    ...request.breakouts.map(
      (b) => `- "${oneLine(b.title).slice(0, 120)}" (${oneLine(b.channel).slice(0, 40)}, ${b.views.toLocaleString("en-US")} views${b.multiplier ? `, ${b.multiplier.toFixed(1)}x usual` : ""})`,
    ),
    ``,
    `Give the topics, formats and ideas.`,
  );
  return parts.join("\n");
}
