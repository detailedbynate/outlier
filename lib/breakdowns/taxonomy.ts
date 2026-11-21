import { z } from "zod";

/**
 * One fixed vocabulary for describing what a video or channel does, shared by
 * the video breakdowns and the channel profiles so the two can be filtered and
 * grouped the same way. Each key has a short label for chips and badges and a
 * description that tells Claude (and a member hovering it) exactly what fits.
 * Add to these lists rather than renaming keys: stored rows use the keys.
 */
interface Term {
  label: string;
  description: string;
}

/** How the first second or two grabs a scrolling viewer. */
export const HOOK_TYPES = {
  question: { label: "Question", description: "Opens by asking the viewer something they want answered." },
  bold_claim: { label: "Bold claim", description: "A surprising statement, hot take or 'nobody knows this' line." },
  shock_visual: { label: "Shock visual", description: "A strange, extreme or eye-catching first frame that does the work before any words." },
  curiosity_gap: { label: "Curiosity gap", description: "Teases an outcome or reveal and holds it back until the end." },
  challenge: { label: "Challenge", description: "Sets up a test, bet, dare or 'can I do X' to see through." },
  ranking: { label: "Ranking", description: "Promises a countdown, tier list or 'top N' from the start." },
  story_opener: { label: "Story opener", description: "Drops straight into the middle of a story or situation." },
  how_to_promise: { label: "How-to promise", description: "Promises a quick, useful result: 'how to X in 10 seconds'." },
  relatable: { label: "Relatable moment", description: "An everyday situation the viewer instantly recognises from their own life." },
  reaction: { label: "Reaction", description: "Reacting to a clip, comment, result or someone else's content." },
  trend: { label: "Trend / meme", description: "Rides a trending sound, format, meme or event people already know." },
  other: { label: "Other", description: "None of the above fits." },
} as const satisfies Record<string, Term>;

/** What kind of video it is: the format a creator would copy. */
export const VIDEO_STYLES = {
  facts: { label: "Facts", description: "Rapid facts, trivia or 'did you know' about a topic." },
  ranking: { label: "Ranking / tier list", description: "Ranking, rating or comparing several things against each other." },
  tutorial: { label: "Tutorial / tips", description: "Teaches how to do something: tips, tricks, guides, hacks." },
  story: { label: "Story", description: "Tells a story: true, fictional, animated, Reddit-style or lore." },
  skit: { label: "Skit / comedy", description: "Acted or animated comedy, POV sketches, parodies." },
  reaction: { label: "Reaction / commentary", description: "Responds to or comments on other content, news or drama." },
  challenge: { label: "Challenge / experiment", description: "Tries something to see what happens: challenges, experiments, tests." },
  gameplay: { label: "Gameplay moment", description: "A clip of a game: a clutch play, glitch, funny moment, build or run." },
  satisfying: { label: "Satisfying / process", description: "Oddly satisfying, crafting, cooking, cleaning or building from start to finish." },
  transformation: { label: "Before / after", description: "A transformation, glow-up, restoration or progress reveal." },
  news: { label: "News / update", description: "New releases, updates, leaks or what just happened." },
  compilation: { label: "Compilation", description: "Several clips or moments stitched together." },
  edit: { label: "Edit / montage", description: "Music-driven edits, montages, fan edits or highlight reels." },
  prank: { label: "Prank / social", description: "Pranks, street interviews or filming reactions from the public." },
  other: { label: "Other", description: "None of the above fits." },
} as const satisfies Record<string, Term>;

/** The feeling that makes people watch to the end, replay and share. */
export const ANGLES = {
  curiosity: { label: "Curiosity", description: "The viewer has to know how it ends or what the answer is." },
  humor: { label: "Humor", description: "It's funny." },
  awe: { label: "Awe", description: "Impressive skill, scale, beauty or rarity." },
  satisfaction: { label: "Satisfaction", description: "Pleasing to watch: things fitting, finishing, getting clean or perfect." },
  nostalgia: { label: "Nostalgia", description: "Brings back childhood, old games, old internet or past eras." },
  controversy: { label: "Controversy", description: "Invites disagreement, debate or outrage in the comments." },
  tension: { label: "Tension", description: "Fear, suspense, danger or high stakes." },
  inspiration: { label: "Inspiration", description: "Motivating, aspirational or uplifting." },
  relatability: { label: "Relatability", description: "'That's so me': viewers see themselves in it." },
  competition: { label: "Competition", description: "Who wins, who's better, rivalry or scores." },
  wholesome: { label: "Wholesome", description: "Warm, kind or cute." },
  usefulness: { label: "Usefulness", description: "The viewer gets something they can use." },
  other: { label: "Other", description: "None of the above fits." },
} as const satisfies Record<string, Term>;

/** How a channel delivers its videos. */
export const PRESENTATIONS = {
  on_camera: { label: "On camera", description: "The creator talks to or performs for the camera." },
  voiceover: { label: "Voiceover", description: "A voice (human or AI) narrates over footage, gameplay or images." },
  text_on_screen: { label: "Text on screen", description: "Captions or text carry the video, with music and no narration." },
  gameplay_no_voice: { label: "Gameplay, no voice", description: "Raw or lightly edited gameplay with sound effects or music only." },
  animation: { label: "Animation", description: "Animated characters, drawings or 3D." },
  footage_music: { label: "Clips + music", description: "Footage, clips or edits set to music." },
  mixed: { label: "Mixed", description: "Changes from video to video." },
} as const satisfies Record<string, Term>;

/** The overall feel of a channel. */
export const TONES = {
  hype: { label: "Hype", description: "Loud, fast, high energy." },
  funny: { label: "Funny", description: "Comedy first." },
  educational: { label: "Educational", description: "Explains and informs." },
  calm: { label: "Calm", description: "Relaxed, slow, soothing." },
  dramatic: { label: "Dramatic", description: "Serious, intense, cinematic." },
  wholesome: { label: "Wholesome", description: "Warm, kind, family friendly." },
  dark: { label: "Dark / creepy", description: "Horror, mystery, true crime or unsettling." },
  inspirational: { label: "Inspirational", description: "Motivation and self improvement." },
  mixed: { label: "Mixed", description: "Changes from video to video." },
} as const satisfies Record<string, Term>;

export type HookType = keyof typeof HOOK_TYPES;
export type VideoStyle = keyof typeof VIDEO_STYLES;
export type Angle = keyof typeof ANGLES;
export type Presentation = keyof typeof PRESENTATIONS;
export type Tone = keyof typeof TONES;

const keys = <T extends Record<string, Term>>(terms: T) => Object.keys(terms) as [keyof T & string, ...(keyof T & string)[]];

/** A label for a stored key, falling back to the key itself if the list changed since. */
export function termLabel(terms: Record<string, Term>, key: string | null | undefined): string | null {
  if (!key) return null;
  return terms[key]?.label ?? key.replace(/_/g, " ");
}

export function termDescription(terms: Record<string, Term>, key: string | null | undefined): string | undefined {
  return key ? terms[key]?.description : undefined;
}

/** The list written out for a prompt: `key: description`, one per line. */
export function describeTerms(terms: Record<string, Term>): string {
  return Object.entries(terms)
    .map(([key, term]) => `- ${key}: ${term.description}`)
    .join("\n");
}

// The SDK's structured-output helper passes enums to the model as a hint, not a
// hard constraint, so an off-list answer is filed under the catch-all instead of
// failing the whole response.
export const hookTypeSchema = z.enum(keys(HOOK_TYPES)).catch("other");
export const videoStyleSchema = z.enum(keys(VIDEO_STYLES)).catch("other");
export const angleSchema = z.enum(keys(ANGLES)).catch("other");
export const presentationSchema = z.enum(keys(PRESENTATIONS)).catch("mixed");
export const toneSchema = z.enum(keys(TONES)).catch("mixed");
