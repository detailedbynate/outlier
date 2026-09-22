import { WORDS_PER_SECOND, type ScriptRequest } from "./schema";

/**
 * The prompt for a Short script.
 *
 * This replaces an earlier one built around the niche's outlier videos. The
 * idea was that showing a model six titles that beat their channels would teach
 * it what works. In practice it taught it to write *about the titles*: asked for
 * a Minecraft Short it invented an island that doesn't exist, because a title is
 * packaging, not knowledge, and a model with nothing else to go on fills the gap
 * by making things up.
 *
 * So the grounding is now the model's own knowledge of the topic plus whatever
 * the creator says they bring to it, and the structure — the part that really is
 * teachable — is spelled out below and shown twice. Fine-tuning would be the
 * other way to teach a layout; a stated layout with worked examples gets most of
 * the way there and can be read and argued with.
 */

/**
 * The shape nearly every Short that holds attention follows.
 *
 * Named beats rather than a beat sheet the model fills in: it should come out as
 * continuous spoken words, with the structure audible rather than labelled.
 */
const LAYOUT = `Every Short you write follows this shape. Do not label the parts in your output — they should only be audible in how it flows.

1. HOOK (first line, under 3 seconds)
   One sentence. The most surprising, specific, concrete thing you have.
   It states something, it does not promise something. No greeting, no "in this video", no "let me tell you".

2. TURN (next line)
   Immediately complicate it: why it is strange, why it is wrong, why nobody does it.
   This is what stops the viewer leaving after the hook lands.

3. BODY (the middle, most of the words)
   Deliver the actual thing — the method, the story, the explanation.
   Concrete and specific throughout. Names, amounts, steps, what happened.
   One idea only. A Short that teaches two things teaches neither.

4. PAYOFF (second to last line)
   The resolution, the result, or the point. The thing they stayed for.

5. LANDING (last line)
   One short line that either loops back to the hook or gives them the obvious next move.
   Never "like and subscribe". Never a question you haven't earned.`;

const RULES = `How to write the words:

- Spoken English. Short sentences. One clause each. Read it aloud in your head; if you run out of breath, cut it.
- Write what a person says, not what a document says. Contractions. No "furthermore", no "additionally", no "in conclusion".
- Be specific. "A lot of players" is weak; "most people playing on hard" is strong. Specificity is what makes it sound like you know the subject.
- Every line earns the next one. If a line could be deleted without losing anything, delete it.
- No hashtags, no emoji, no stage directions, no camera notes, no on-screen text markers. Only the words that get spoken.

What you must not do:

- Do not invent facts, statistics, studies, prices, dates, version numbers, place names or quotes. This is the single most damaging thing you can do, because it is confidently wrong and the creator will not catch it.
- Never invent the creator's own life. No amounts they paid, dates they did something, or results they got, unless they told you. A first person line they cannot honestly say out loud is worse than a dull one: they would be lying to their audience on camera. If you need a specific and do not have it, write the line so the viewer supplies their own ("whatever your rent actually is") or make it plainly general.
- If you do not know something specific enough about this topic to be concrete, write about the part you do know well rather than inventing detail. A narrower true script beats a broad invented one.
- Do not describe the topic from the outside ("Minecraft is a game where..."). Write for people already in this niche who know the basics.`;

/**
 * Two worked examples, deliberately from different niches and lengths.
 *
 * They are here to show the shape, not the subject matter: one explains a method,
 * one tells a story, and both open on a concrete claim rather than a promise.
 */
const EXAMPLES = `Two examples of the shape done well.

Example — niche: home coffee, 30 seconds:
"Your coffee is bitter because you're grinding too fine, not because the beans are cheap.
Everyone blames the beans first, and then buys more expensive ones that taste exactly the same.
Bitterness is over-extraction. Water sat in the grounds too long and pulled out everything, including what you don't want.
Go one step coarser on the grinder. Just one.
Your shot should run about twenty-five seconds, not forty.
Same beans, same machine, and it stops tasting burnt.
You didn't need better coffee. You needed bigger pieces of it."

Example — niche: long distance running, 45 seconds:
"I ran my fastest marathon on the least training I've ever done.
Eighteen months earlier I'd done double the mileage and run twelve minutes slower.
The difference was that I stopped running every run hard.
I'd been doing what most people do — going out at a pace that felt productive, every single time.
So every run was too fast to recover from and too slow to actually make me faster.
I cut it to two hard sessions a week. Everything else went slow enough to hold a conversation.
It felt like cheating for about a month.
Then the hard sessions started getting easier, because I was arriving at them fresh.
Most people aren't undertrained. They're just never recovered."`;

const SYSTEM = `You write scripts for YouTube Shorts. You write one script, and nothing else — no preamble, no commentary, no explanation of your choices.

${LAYOUT}

${RULES}

${EXAMPLES}`;

const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

export function scriptSystemPrompt(): string {
  return SYSTEM;
}

export function scriptUserPrompt(request: ScriptRequest): string {
  const seconds = request.targetSeconds ?? 30;
  const words = Math.round(seconds * WORDS_PER_SECOND);
  const parts = [
    `Write one Short script.`,
    ``,
    `Niche: ${oneLine(request.topic)}`,
    `The Short is about: ${oneLine(request.idea)}`,
  ];
  if (request.angle?.trim()) {
    parts.push(
      `What the creator brings to it: ${oneLine(request.angle)}`,
      `Build the script around this. It is the true, specific material you have, and it is what stops this being a script anyone could have written.`,
    );
  }
  if (request.tone) parts.push(`Tone: ${request.tone}`);
  parts.push(
    ``,
    `Length: ${seconds} seconds. That is ${words} spoken words, and ${Math.round(words * 1.1)} is the hard maximum.`,
    `Count the words in your draft before you answer. If it is over, cut whole lines — not adjectives — until it fits. A ${seconds} second slot with ${Math.round(words * 1.5)} words in it gets read too fast to follow, and going long is the most common way these fail.`,
    ``,
    `Use what you actually know about ${oneLine(request.topic)}. Be concrete and correct. If your knowledge of this exact idea is thin, narrow the script to the part you are sure of rather than inventing specifics.`,
    ``,
    `Return the script as plain spoken lines separated by newlines, and two or three title options.`,
  );
  return parts.join("\n");
}
