import {
  channelReferenceSchema,
  MAX_COMPETITORS,
  MAX_NICHES,
  nicheSchema,
  type ContentFormatValue,
  type GoalValue,
  type OnboardingInput,
} from "./schema";

/** Pure onboarding step logic, kept out of the UI so it can be tested and reused. */

export const STEP_IDS = ["welcome", "goals", "formats", "niches", "channel", "competitors", "complete"] as const;
export type StepId = (typeof STEP_IDS)[number];

/** Question steps count toward progress; welcome and complete don't. */
export const QUESTION_STEPS: StepId[] = ["goals", "formats", "niches", "channel", "competitors"];

export interface OnboardingDraft {
  goals: GoalValue[];
  contentFormats: ContentFormatValue[];
  niches: string[];
  hasChannel: boolean | null;
  channel: string;
  competitors: string[];
}

export const EMPTY_DRAFT: OnboardingDraft = {
  goals: [],
  contentFormats: [],
  niches: [],
  hasChannel: null,
  channel: "",
  competitors: [],
};

/** Steps the user may skip (optional questions). */
export const SKIPPABLE: ReadonlySet<StepId> = new Set(["niches", "competitors"]);

export function progressFor(step: StepId): number {
  if (step === "welcome") return 0;
  if (step === "complete") return 1;
  return (QUESTION_STEPS.indexOf(step) + 1) / (QUESTION_STEPS.length + 1);
}

/** Error that blocks leaving `step`, or null when the user can continue. */
export function stepError(step: StepId, draft: OnboardingDraft): string | null {
  switch (step) {
    case "goals":
      return draft.goals.length === 0 ? "Pick at least one to continue." : null;
    case "formats":
      return draft.contentFormats.length === 0 ? "Pick the kind of content you make." : null;
    case "channel": {
      if (draft.hasChannel === null) return "Let us know if you have a channel.";
      if (!draft.hasChannel) return null;
      const result = channelReferenceSchema.safeParse(draft.channel);
      return result.success ? null : (result.error.issues[0]?.message ?? "Enter your channel.");
    }
    default:
      return null;
  }
}

export function toggleValue<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

/** "Both" selects Shorts and Long-form together; tapping it again clears both. */
export function toggleBothFormats(formats: readonly ContentFormatValue[]): ContentFormatValue[] {
  return formats.length === 2 ? [] : ["shorts", "long_form"];
}

export type AddResult = { ok: true; values: string[] } | { ok: false; error: string };

export function addNiche(niches: readonly string[], raw: string): AddResult {
  const parsed = nicheSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid niche." };
  if (niches.some((n) => n.toLowerCase() === parsed.data.toLowerCase())) return { ok: false, error: "Already added." };
  if (niches.length >= MAX_NICHES) return { ok: false, error: `You can add up to ${MAX_NICHES} niches.` };
  return { ok: true, values: [...niches, parsed.data] };
}

export function addCompetitor(competitors: readonly string[], raw: string): AddResult {
  const parsed = channelReferenceSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid channel." };
  if (competitors.some((c) => c.toLowerCase() === parsed.data.toLowerCase())) return { ok: false, error: "Already added." };
  if (competitors.length >= MAX_COMPETITORS) return { ok: false, error: `You can add up to ${MAX_COMPETITORS} channels.` };
  return { ok: true, values: [...competitors, parsed.data] };
}

export function toSubmission(draft: OnboardingDraft): OnboardingInput {
  return {
    goals: draft.goals,
    contentFormats: draft.contentFormats,
    niches: draft.niches,
    hasChannel: draft.hasChannel === true,
    channel: draft.hasChannel ? draft.channel : null,
    competitors: draft.competitors,
  };
}

/** Which step to send the user back to for a server-side validation field. */
export function stepForField(field: string | undefined): StepId | null {
  switch (field) {
    case "goals":
      return "goals";
    case "contentFormats":
      return "formats";
    case "niches":
      return "niches";
    case "hasChannel":
    case "channel":
      return "channel";
    case "competitors":
      return "competitors";
    default:
      return null;
  }
}
