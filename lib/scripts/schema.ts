import { z } from "zod";

/**
 * What a Short script is here: the words, and a few titles to put on them.
 *
 * It used to be a beat sheet — spoken line, on-screen text, shot direction and
 * a duration for each — plus the reasoning behind the hook and the videos it
 * studied. That was a lot of apparatus around a thing whose whole job is to be
 * read out loud, and it made the model spend its budget describing shots
 * instead of writing well. A creator wants the script.
 */

export const SCRIPT = z.object({
  /**
   * The whole thing, as one block of spoken words.
   *
   * Plain prose rather than structure: it goes straight into a teleprompter or a
   * notes app, and it should read like someone talking, not like a checklist.
   */
  script: z.string().min(1).max(2_000),
  /**
   * Title options, strongest first.
   *
   * Capped hard, not politely: a Short's title is truncated in the feed long
   * before 100 characters, and asked for a title a model writes a sentence.
   */
  titles: z.array(z.string().min(1).max(55)).min(2).max(3),
});

export type Script = z.infer<typeof SCRIPT>;

export interface ScriptResult {
  /** Row id once it's been kept; null when saving failed or there was no user. */
  id: string | null;
  script: Script;
  /** Spoken words, so the UI can show whether it really fits the length. */
  words: number;
  model: string;
}

/**
 * Lengths on offer, in seconds. Capped at 30: the writer is tuned for a single
 * idea delivered fast, and a minute of it turns into padding.
 */
export const DURATIONS = [15, 20, 25, 30] as const;
export type Duration = (typeof DURATIONS)[number];

export const TONES = ["energetic", "calm", "funny", "serious", "story"] as const;
export type Tone = (typeof TONES)[number];

/**
 * Spoken words per second, used for every length calculation here.
 *
 * 2.8 is about 170 words a minute. Conversation runs near 150, and Shorts
 * narration is deliberately faster than conversation — the pace is part of why
 * they hold. The earlier 2.2 was closer to an audiobook, and it made every
 * script look 40% too long when it was actually fine.
 */
export const WORDS_PER_SECOND = 2.8;

export interface ScriptRequest {
  /** The niche to write for, e.g. "minecraft" or "personal finance". */
  topic: string;
  /** What they want to make: a title, or a sentence describing the idea. */
  idea: string;
  /** Their own spin — what they know or have that others don't. Optional, but it's what stops a generic script. */
  angle?: string;
  targetSeconds?: Duration;
  tone?: Tone;
}

/**
 * The script as one flowing block, however the model formatted it.
 *
 * It used to come out a line per sentence, which reads like a list of
 * instructions rather than something a person says. A script is prose you read
 * aloud, so the line breaks go and the sentences run together.
 *
 * The models still sometimes weld sentences with no space after the stop ("a
 * piston.Doors aren't blocks"), so that gets repaired on the way through.
 */
export function scriptText(script: string): string {
  return script
    // A sentence end followed straight by a capital is a missing space, not an abbreviation.
    .replace(/([.!?])(?=["'“]?[A-Z])/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}
