import { z } from "zod";

/**
 * The shape of a Short script.
 *
 * Deliberately not a wall of prose. A Short is spoken over pictures on a clock,
 * so the useful unit is a beat: what is said, what is on screen, and how long
 * it gets. A paragraph is easy to generate and hard to film.
 */

export const BEAT = z.object({
  /** Said out loud. One or two sentences; this is a Short, not a lecture. */
  say: z.string().min(1).max(320),
  /** Words burned on screen, usually shorter than the line. Empty when there are none. */
  onScreen: z.string().max(120).default(""),
  /** What the viewer is looking at. Concrete enough to film or find. */
  visual: z.string().min(1).max(240),
  seconds: z.number().min(0.5).max(30),
});

export const SCRIPT = z.object({
  /**
   * The first line, spoken before anything else. Its own field because most
   * Shorts are lost here and a model given one job does it better.
   */
  hook: z.string().min(1).max(200),
  /** Why this opening earns the next three seconds, in one line. */
  hookReason: z.string().min(1).max(240),
  beats: z.array(BEAT).min(2).max(12),
  /** The last line: what sends them back round or on to the next one. */
  ending: z.string().min(1).max(240),
  /** Title options, strongest first. */
  titles: z.array(z.string().min(1).max(100)).min(2).max(5),
  /** On-screen caption for the post, hashtags included if they earn their place. */
  caption: z.string().max(400).default(""),
  /** What this borrows from the videos it studied, in the writer's own words. */
  whyItWorks: z.string().min(1).max(600),
});

export type ScriptBeat = z.infer<typeof BEAT>;
export type Script = z.infer<typeof SCRIPT>;

/** A real video the script was built from, kept so the advice stays checkable. */
export interface ScriptSource {
  youtubeVideoId: string;
  title: string;
  channelTitle: string;
  views: number;
  /** How far it beat its own channel's usual views. */
  multiplier: number;
  /** Its opening words, when we've read them. */
  opening: string | null;
}

export interface ScriptResult {
  script: Script;
  sources: ScriptSource[];
  /** Total spoken seconds across the beats, so the UI needn't re-add them. */
  seconds: number;
  model: string;
}

export const DURATIONS = [15, 30, 45, 60] as const;
export type Duration = (typeof DURATIONS)[number];

export const TONES = ["energetic", "calm", "funny", "serious", "story"] as const;
export type Tone = (typeof TONES)[number];

export interface ScriptRequest {
  /** The niche to study, e.g. "minecraft" or "personal finance". */
  topic: string;
  /** What they want to make: a title, or a sentence describing the idea. */
  idea: string;
  /** Their own spin — what they know or have that others don't. Optional, but it's what stops a generic script. */
  angle?: string;
  targetSeconds?: Duration;
  tone?: Tone;
}
