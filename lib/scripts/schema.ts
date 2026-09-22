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
   * The whole thing, as it would be spoken, one line per breath.
   *
   * Plain text rather than structure: it goes straight into a teleprompter or a
   * notes app, and any shape it needs is shape the words already have.
   */
  script: z.string().min(1).max(2_000),
  /** Title options, strongest first. */
  titles: z.array(z.string().min(1).max(100)).min(2).max(3),
});

export type Script = z.infer<typeof SCRIPT>;

export interface ScriptResult {
  script: Script;
  /** Spoken words, so the UI can show whether it really fits the length. */
  words: number;
  model: string;
}

export const DURATIONS = [15, 30, 45, 60] as const;
export type Duration = (typeof DURATIONS)[number];

export const TONES = ["energetic", "calm", "funny", "serious", "story"] as const;
export type Tone = (typeof TONES)[number];

/** Spoken words per second. Shorts are read fast; this is what the length maths uses. */
export const WORDS_PER_SECOND = 2.2;

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
 * One spoken line per element, however the model formatted it.
 *
 * Asked for newline-separated lines, the free models often return one run-on
 * block, and sometimes without the space after a full stop ("a piston.Doors
 * aren't blocks"). Splitting on sentence ends recovers the shape either way,
 * which matters because a script is read off a screen a line at a time.
 */
export function scriptLines(script: string): string[] {
  return script
    // A sentence end followed straight by a capital is a missing break, not an abbreviation.
    .replace(/([.!?])\s*(?=["'“]?[A-Z])/g, "$1\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}
