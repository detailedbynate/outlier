/**
 * Viewer requests: comments under the videos that rank for an open niche,
 * asking for a video that doesn't exist yet ("can you do one on HSA vs FSA?").
 * Each is a first video with an audience already waiting for it.
 */

import { z } from "zod";
import type { TextProvider } from "@/lib/ai/types";
import type { VideoComment } from "@/lib/innertube/comments";

/** Cheap first pass, so the model only reads comments that could be asking for something. */
const ASKING =
  /\b(can you|could you|would you|will you|please|pls|plz|would love|would be (?:great|awesome|nice|helpful)|next video|make a video|do a video|video on|video about|part 2|follow.?up|explain|tutorial|cover|what about|how about|how do (?:i|you)|i wish)\b/i;

export function isRequestLike(text: string): boolean {
  return text.length >= 15 && text.length <= 400 && ASKING.test(text);
}

export interface NicheComments {
  niche: string;
  comments: readonly VideoComment[];
}

export interface ViewerRequest {
  niche: string;
  /** The video people asked for, as a title. */
  title: string;
  /** Likes on the comments asking for it. */
  likes: number;
  /** How many comments asked. */
  asks: number;
  /** The most-liked comment that asked, as a link. */
  url: string;
}

const schema = z.object({
  requests: z.array(z.object({ niche: z.string(), title: z.string(), comments: z.array(z.number().int()) })),
});

const PROMPT = `You find video requests in YouTube comments for Outlier, a research tool for creators.

You get comments from the top videos in a few niches, each numbered and with its like count. Find comments asking for a video that the video they're under didn't make: a topic, a follow-up, a comparison, a how-to. Skip praise, jokes, complaints, questions answered by the video itself, and requests aimed only at that creator ("do a face reveal"). Merge comments asking for the same thing. For each request, write the video as a clear title someone could search for (e.g. "HSA vs FSA: which one to pick"), give its niche exactly as given, and list the numbers of the comments that asked. Return at most 25, the most-liked first.`;

export async function extractRequests(ai: Pick<TextProvider, "generateObject">, groups: readonly NicheComments[]): Promise<ViewerRequest[]> {
  const numbered: VideoComment[] = [];
  const blocks = groups.flatMap((g) => {
    const asking = g.comments.filter((c) => isRequestLike(c.text));
    if (asking.length === 0) return [];
    const lines = asking.map((c) => {
      numbered.push(c);
      return `[${numbered.length - 1}] (${c.likes} likes) ${c.text.replace(/\s+/g, " ")}`;
    });
    return [`Niche: ${g.niche}\n${lines.join("\n")}`];
  });
  if (blocks.length === 0) return [];
  const niches = new Set(groups.map((g) => g.niche));
  const { object } = await ai.generateObject({
    system: PROMPT,
    messages: [{ role: "user", content: blocks.join("\n\n") }],
    schema,
    schemaName: "viewer_requests",
    maxOutputTokens: 3_000,
    effort: "low",
  });
  return object.requests.flatMap((r) => {
    const asked = [...new Set(r.comments)].map((i) => numbered[i]).filter((c): c is VideoComment => Boolean(c));
    if (asked.length === 0 || !niches.has(r.niche) || !r.title.trim()) return [];
    const top = [...asked].sort((a, b) => b.likes - a.likes)[0]!;
    return [
      {
        niche: r.niche,
        title: r.title.trim().slice(0, 200),
        likes: asked.reduce((sum, c) => sum + c.likes, 0),
        asks: asked.length,
        url: `https://www.youtube.com/watch?v=${top.videoId}&lc=${top.id}`,
      },
    ];
  });
}
