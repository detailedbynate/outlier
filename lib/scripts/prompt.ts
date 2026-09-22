import type { ScriptRequest, ScriptSource } from "./schema";

/**
 * The prompt for a Short script.
 *
 * The whole point of writing this here rather than letting someone paste a
 * topic into a chatbot is the evidence: real videos from the niche, each one
 * measured against its own channel's usual views, with the words it opened on.
 * A model told "write a Short about fishing" invents a generic one. A model
 * shown six openings that beat their channels by 4x last week has something to
 * reason from, and the rules below are mostly about making it reason from that
 * rather than from its own habits.
 */

const SYSTEM = `You write scripts for YouTube Shorts.

You will be given real Shorts from one niche that measurably outperformed the channels that posted them, including the words they opened on. Study them. Write one new script.

How Shorts actually work:
- The first line is the whole game. A viewer decides in under a second, while the video is still loading, and they decide on what they hear and see, not on what you promise to show later.
- Never open by greeting, introducing yourself, or saying what the video will be about. "In this video I'm going to show you" is a scroll.
- Open on the most surprising or most concrete thing available: a result, a number, a contradiction, a mistake, a mid-action moment.
- Keep one question alive at all times. The moment the viewer knows how it ends, they leave.
- Spoken English, short sentences, no subordinate clauses stacked up. Read it aloud in your head; if you run out of breath, cut it.
- Roughly 2.2 words per second of speech. A 30-second Short is about 65 to 70 spoken words in total. Respect the target length — going over is the most common way these fail.
- On-screen text is not the spoken line repeated. It is the number, the name, or the punchline.
- Visual directions must be things the creator can actually film or find. "Dynamic montage" is not a direction.

Constraints:
- Do not invent statistics, studies, prices, dates or quotes. If a number would help and you do not have one, write the line so it does not need one.
- Do not copy sentences from the examples. Take their structure, not their words.
- Do not reference the examples inside the script itself.
- No hashtags in spoken lines.`;

const dashes = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

function exampleBlock(sources: readonly ScriptSource[]): string {
  if (sources.length === 0) {
    return `No measured examples are available for this niche yet. Write from the principles above and keep the script concrete.`;
  }
  const lines = sources.map((source, i) => {
    const parts = [
      `${i + 1}. "${dashes(source.title)}"`,
      `   ${source.multiplier.toFixed(1)}x its channel's usual views · ${source.views.toLocaleString("en-US")} views · ${dashes(source.channelTitle)}`,
    ];
    // The opening is the valuable part; the title alone only shows packaging.
    if (source.opening) parts.push(`   opens on: "${dashes(source.opening)}"`);
    return parts.join("\n");
  });
  return `These Shorts beat the channels that posted them, in this niche, recently:\n\n${lines.join("\n\n")}`;
}

export function scriptSystemPrompt(): string {
  return SYSTEM;
}

export function scriptUserPrompt(request: ScriptRequest, sources: readonly ScriptSource[]): string {
  const seconds = request.targetSeconds ?? 30;
  const words = Math.round(seconds * 2.2);
  const parts = [
    exampleBlock(sources),
    ``,
    `Now write a new Short.`,
    ``,
    `Niche: ${dashes(request.topic)}`,
    `Idea: ${dashes(request.idea)}`,
  ];
  if (request.angle?.trim()) parts.push(`What the creator brings to it: ${dashes(request.angle)}`);
  if (request.tone) parts.push(`Tone: ${request.tone}`);
  parts.push(
    ``,
    `Length: ${seconds} seconds. The spoken words across every beat should come to roughly ${words} words, and the beat seconds should add up to about ${seconds}.`,
    ``,
    `Before writing, work out what the openings above have in common — the move they make, not the topic they cover — and make the hook do that same move for this idea.`,
    ``,
    `In whyItWorks, name the specific pattern you took from the examples and how this script uses it. Be concrete; do not restate the rules.`,
  );
  return parts.join("\n");
}
