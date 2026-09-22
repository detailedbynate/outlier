import type { Duration, ScriptResult, Tone } from "@/lib/scripts/schema";

/**
 * Form state shared by the action and the form.
 *
 * Its own module because a "use server" file may only export async functions —
 * a constant alongside the action builds fine and fails at runtime.
 */

export interface ScriptState {
  result: ScriptResult | null;
  error: string | null;
  /** Credits this script cost, so the form can say so without re-reading the meter. */
  charged: number;
  /** Echoed back so the form keeps what they typed after a submit. */
  sent: { topic: string; idea: string; angle: string; seconds: Duration; tone: Tone };
}

export const DEFAULT_SECONDS: Duration = 30;
export const DEFAULT_TONE: Tone = "energetic";

export const emptyScriptState: ScriptState = {
  result: null,
  error: null,
  charged: 0,
  sent: { topic: "", idea: "", angle: "", seconds: DEFAULT_SECONDS, tone: DEFAULT_TONE },
};
