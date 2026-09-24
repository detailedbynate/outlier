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

1. HOOK (the opening sentence, under 2 seconds)
   One very short sentence: 8 words at most, ideally fewer. The most surprising, specific, concrete thing you have.
   Short beats clever: "Your coffee is bitter for one reason." not a long setup.
   It states something, it does not promise something. No greeting, no "in this video", no "let me tell you".

2. TURN (the next sentence or two)
   Immediately complicate it: why it is strange, why it is wrong, why nobody does it.
   This is what stops the viewer leaving after the hook lands.

3. BODY (the middle, most of the words)
   Deliver the actual thing — the method, the story, the explanation.
   Concrete and specific throughout. Names, amounts, steps, what happened.
   One idea only. A Short that teaches two things teaches neither.

4. PAYOFF (near the end)
   The resolution, the result, or the point. The thing they stayed for.

5. LANDING (the final sentence)
   One short sentence that either loops back to the hook or gives them the obvious next move.
   Never "like and subscribe". Never a question you haven't earned.`;

const RULES = `How to write the words:

- Simple words. Write the way a 12-year-old talks: everyday words, no fancy vocabulary, no jargon unless the niche uses it every day. If there's a shorter, plainer word, use it ("use" not "utilize", "fix" not "remedy", "a lot" not "substantially").
- Spoken English. Short sentences. One clause each. Read it aloud in your head; if you run out of breath, cut it.
- Write what a person says, not what a document says. Contractions. No "furthermore", no "additionally", no "in conclusion".
- Be specific. "A lot of players" is weak; "most people playing on hard" is strong. Specificity is what makes it sound like you know the subject.
- Every sentence earns the next one. If a sentence could be deleted without losing anything, delete it.
- No hashtags, no emoji, no stage directions, no camera notes, no on-screen text markers. Only the words that get spoken.
- Write the script as continuous prose — sentences running on from each other, the way someone talks. Do not put each sentence on its own line, and do not number, bullet or label anything.

What you must not do:

- Do not invent facts, statistics, studies, prices, dates, version numbers, place names or quotes. This is the single most damaging thing you can do, because it is confidently wrong and the creator will not catch it.
- Never invent the creator's own life. No amounts they paid, dates they did something, or results they got, unless they told you. A first person sentence they cannot honestly say out loud is worse than a dull one: they would be lying to their audience on camera. If you need a specific and do not have it, write the sentence so the viewer supplies their own ("whatever your rent actually is") or make it plainly general.
- If you do not know something specific enough about this topic to be concrete, write about the part you do know well rather than inventing detail. A narrower true script beats a broad invented one.
- Do not describe the topic from the outside ("Minecraft is a game where..."). Write for people already in this niche who know the basics.`;

/**
 * Two worked examples, deliberately from different niches and lengths.
 *
 * They are here to show the shape, not the subject matter: one explains a method,
 * one tells a story, and both open on a concrete claim rather than a promise.
 */
const EXAMPLES = `Two examples of the shape done well.

Example — niche: home coffee, 25 seconds:
"Your coffee is bitter for one reason. You're grinding too fine, not buying cheap beans. Everyone blames the beans first, then buys expensive ones that taste exactly the same. Bitter means the water pulled too much out of the grounds, including the bad stuff. Go one step coarser on the grinder. Just one. Same beans, same machine, and it stops tasting burnt. You didn't need better coffee. You needed bigger pieces of it."

Example — niche: long distance running, 30 seconds:
"You're not undertrained. You're tired. Most runners are never recovered. The usual week is every run at a pace that feels productive, and that pace is the problem. It's too fast to recover from and too slow to make you faster, so you get the fatigue without the fitness. Keep two hard sessions a week. Run everything else slow enough to hold a conversation. It feels like cheating for about a month, and then the hard days get easier, because you finally show up to them fresh."`;

/** Enough samples to show a voice rather than one person's off day. */
const MIN_SAMPLES = 2;
/** Beyond this the samples crowd out the instructions and cost real money per call. */
const MAX_SAMPLES = 3;
/**
 * A 30 second Short is about 85 words, under 600 characters. Past this a sample
 * is usually a long-form transcript, and the voice is in the first few lines anyway.
 */
const MAX_SAMPLE_CHARS = 1_200;

/**
 * Their own scripts, shown as the voice to write in.
 *
 * These replace the built-in pair rather than joining them: two invented
 * examples sitting beside someone's real writing is a second voice in the room,
 * and the model splits the difference.
 */
function sampleBlock(samples: readonly string[]): string {
  const usable = samples
    .map((sample) => sample.trim())
    .filter((sample) => sample.length >= 40)
    .slice(0, MAX_SAMPLES)
    .map((sample) => (sample.length > MAX_SAMPLE_CHARS ? `${sample.slice(0, MAX_SAMPLE_CHARS)}…` : sample));
  if (usable.length < MIN_SAMPLES) return EXAMPLES;

  const blocks = usable.map((sample, i) => `Their script ${i + 1}:\n"${sample}"`).join("\n\n");
  return `These are scripts this creator has written. This is the voice to write in — their rhythm, their sentence length, how blunt or warm they are, the kind of thing they say out loud.

${blocks}

Match how they write. Do not copy their sentences, reuse their specific examples, or write about what these scripts were about. If their style conflicts with a rule above, their style wins, except on inventing facts, which is never allowed.`;
}

const SYSTEM_HEAD = `You write scripts for YouTube Shorts. You write one script, and nothing else — no preamble, no commentary, no explanation of your choices.`;

const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

export function scriptSystemPrompt(samples: readonly string[] = []): string {
  return `${SYSTEM_HEAD}

${LAYOUT}

${RULES}

${sampleBlock(samples)}`;
}

/**
 * Ideas about something new: an update, a patch, a season. The model's
 * knowledge stops at its training date, so for these it can only guess at the
 * contents — asked for "the new Blizzard Island update" both models invented
 * one. Words, not dates, because the idea box is all there is to go on.
 */
const RECENT = /\b(new|update[sd]?|patch(es)?|season|release[sd]?|just (dropped|came out|added)|leak(s|ed)?|event|rework(ed)?|nerf(s|ed)?|buff(s|ed)?|20\d\d)\b/i;

export function soundsRecent(idea: string): boolean {
  return RECENT.test(idea);
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
  if (soundsRecent(request.idea)) {
    parts.push(
      ``,
      request.angle?.trim()
        ? `This may be about something newer than your knowledge. Treat what the creator told you above as the only source for what is new; do not add features, changes, names or numbers of your own.`
        : `This may be about something newer than your knowledge, and the creator hasn't said what is in it. Do not guess at its contents: no invented features, changes, names or numbers. Write about what is true either way — what to check first, what usually matters in this kind of change, how to judge it — and keep every claim about the new thing itself general.`,
    );
  }
  if (request.tone) parts.push(`Tone: ${request.tone}`);
  parts.push(
    ``,
    `Length: ${seconds} seconds. That is ${words} spoken words, and ${Math.round(words * 1.1)} is the hard maximum.`,
    `Count the words in your draft before you answer. If it is over, cut whole sentences — not adjectives — until it fits. A ${seconds} second slot with ${Math.round(words * 1.5)} words in it gets read too fast to follow, and going long is the most common way these fail.`,
    ``,
    `Use what you actually know about ${oneLine(request.topic)}. Be concrete and correct. If your knowledge of this exact idea is thin, narrow the script to the part you are sure of rather than inventing specifics.`,
    ``,
    `Return the script as one continuous block of spoken words, and two or three title options.`,
    `Titles: six words at most, under 50 characters, and no colons or subtitles. "Why your piston door breaks" is a title; "The Redstone Bug Everyone Blames On The Door And How To Fix It" is a sentence.`,
  );
  return parts.join("\n");
}
