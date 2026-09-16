/**
 * Niche Finder takes plain questions, not just keywords: "good niches around
 * fitness", "what should I post about", "top niches right now". This works out
 * whether someone named a topic or is asking to be shown some.
 */

import { topicKey } from "./analysis";

export type NicheIntent = "browse" | "research";

export interface NicheQuery {
  intent: NicheIntent;
  /** The topic to research, or null when they're asking to browse. */
  topic: string | null;
}

/** Lead-ins people type before the topic they mean. */
const LEAD_INS = [
  /^(hey |hi |ok |okay )?(can you |could you |please )?(show|give|find|tell|suggest|recommend)( me)?( some| a| the)?\b/,
  /^(what|which|who)('s| is| are| were)?\b/,
  /^(i want|i need|im looking for|i'm looking for|looking for|help me find|help me with|i should)\b/,
  /^(the )?(best|good|great|top|popular|profitable|easy|easiest|growing|rising|underrated|untapped|trending|hot|new)\b/,
  /^(youtube |yt )?(sub ?niches?|niches?|topics?|ideas?|categories|content|videos?|channels?|markets?)\b/,
  /^(to (start|make|post|do|grow|try)|for (me|starting|beginners?)|about|around|within|related to|like|in|on|for|of|with|near|surrounding)\b/,
  /^(right now|now|today|currently|this year|in \d{4})\b/,
  /^(should i (make|do|post|start)|i can (make|do|post|start)|to (make|post) videos? (about|on|in))\b/,
];

/** Trailing filler that isn't part of the topic. */
const TRAILERS = [
  /\b(niches?|sub ?niches?|ideas?|topics?|content|videos?|channels?)$/,
  /\b(right now|now|today|please|thanks|thank you|for me|to start|for beginners?|in \d{4})$/,
  /[?.!,]+$/,
];

function strip(value: string): string {
  let text = value.toLowerCase().replace(/\s+/g, " ").trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of [...LEAD_INS, ...TRAILERS]) {
      const next = text.replace(pattern, " ").replace(/\s+/g, " ").trim();
      if (next !== text) {
        text = next;
        changed = true;
      }
    }
  }
  return text;
}

/**
 * A topic needs a real word; what's left after stripping filler can be empty
 * ("top niches") or too vague to search ("something fun"), which means browse.
 */
export function parseNicheQuery(input: string): NicheQuery {
  const raw = (input ?? "").trim().slice(0, 120);
  if (!raw) return { intent: "browse", topic: null };

  const stripped = strip(raw);
  // Nothing but filler, or a phrase so short it can't be a topic.
  if (stripped.length < 2) return { intent: "browse", topic: null };

  const topic = stripped.slice(0, 60).trim();
  // The key is what the cache and stored data use, so it has to be usable.
  return topicKey(topic).length >= 2 ? { intent: "research", topic } : { intent: "browse", topic: null };
}
