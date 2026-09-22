import { z } from "zod";

/**
 * Video ideas for a niche.
 *
 * The version of this people do by hand is pasting a pile of their own scripts
 * into a chatbot and asking what to make next. That works because the scripts
 * carry the voice and the subject matter at once. The advantage here is that we
 * already hold both, plus every idea already made — so the one thing a chatbot
 * cannot do is avoid suggesting something twice.
 */

export const IDEA = z.object({
  /** The video, as a title someone would actually click. Same limits as a script title. */
  title: z.string().min(1).max(55),
  /** The first line of the Short, so the idea can be judged on whether it opens well. */
  hook: z.string().min(1).max(160),
  /** Why this one is worth making, in a line. Not a summary of the title. */
  why: z.string().min(1).max(200),
});

export const IDEAS = z.object({
  ideas: z.array(IDEA).min(3).max(10),
});

export type Idea = z.infer<typeof IDEA>;

export interface IdeaResult {
  ideas: Idea[];
  model: string;
}

/** Enough to choose from without turning into a list nobody reads. */
export const IDEA_COUNT = 6;

const SYSTEM = `You come up with ideas for YouTube Shorts. You return ideas only — no preamble, no commentary.

What makes an idea good:

- It is about one specific thing, not a topic. "Redstone" is a topic. "Why your piston door jams after you add a repeater" is an idea.
- It has a reason someone stops scrolling: a mistake they are probably making, a result that sounds wrong, a thing everyone believes that isn't true, or a specific method with a specific outcome.
- It can be shot by one person with what they already have. No budget, no crew, no travel.
- It is answerable in under a minute. If it needs five minutes to make sense, it is a long-form idea.
- Somebody in this niche would recognise it as a real problem or a real question. Not a generic "top 5 tips".

What to avoid:

- Anything you cannot be concrete about. If you don't know the subject well enough to write the hook, don't suggest it.
- Inventing facts, numbers, versions, prices or events to make an idea sound compelling.
- Suggesting something the creator has already made. You will be shown what they have written.
- Near-duplicates of each other. Six ideas should be six different videos, not one idea phrased six ways.
- Titles that are sentences. Six words at most, no colons.`;

const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

export function ideaSystemPrompt(): string {
  return SYSTEM;
}

export interface IdeaRequest {
  topic: string;
  /** What they already made, so nothing comes back twice. */
  alreadyMade: readonly string[];
  /** Their own scripts, which show the kind of thing they cover and how they cover it. */
  samples: readonly string[];
  count?: number;
}

export function ideaUserPrompt(request: IdeaRequest): string {
  const count = request.count ?? IDEA_COUNT;
  const parts = [`Come up with ${count} Short ideas for this niche.`, ``, `Niche: ${oneLine(request.topic)}`];

  if (request.samples.length > 0) {
    // Their writing shows the depth they work at, which is what keeps ideas at the right level.
    const shown = request.samples.slice(0, 3).map((sample) => `"${oneLine(sample).slice(0, 600)}"`);
    parts.push(
      ``,
      `Scripts this creator has written, so you can see the level they pitch at and the kind of thing they find worth saying:`,
      ...shown,
    );
  }

  if (request.alreadyMade.length > 0) {
    parts.push(
      ``,
      `They have already made these. Do not suggest any of them again, or a rewording of one:`,
      ...request.alreadyMade.slice(0, 40).map((made) => `- ${oneLine(made)}`),
    );
  }

  parts.push(
    ``,
    `For each idea give the title, the opening line of the Short, and one line on why it earns attention.`,
    `Use what you actually know about ${oneLine(request.topic)}. An idea you can't be specific about is not an idea.`,
  );
  return parts.join("\n");
}
