/**
 * Referral milestones. Each friend who creates an account earns a flat bonus;
 * hitting a milestone adds a bigger one on top. The last milestone repeats, so
 * there is always a next goal no matter how many friends someone brings.
 */

export interface Milestone {
  /** Friends with an account needed to reach it. */
  at: number;
  /** Extra credits granted on top of the per-friend bonus. */
  credits: number;
}

/** Parse "1:75,3:100" into sorted milestones; unparseable entries are skipped. */
export function parseMilestones(spec: string): Milestone[] {
  const milestones: Milestone[] = [];
  for (const part of spec.split(",")) {
    const [at, credits] = part.split(":").map((value) => Number.parseInt(value.trim(), 10));
    if (Number.isInteger(at) && Number.isInteger(credits) && at! > 0 && credits! >= 0) {
      milestones.push({ at: at!, credits: credits! });
    }
  }
  return milestones.sort((a, b) => a.at - b.at);
}

/** Bonus for landing exactly on `count` friends (0 when it isn't a milestone). */
export function milestoneBonus(milestones: Milestone[], count: number): number {
  const exact = milestones.find((m) => m.at === count);
  if (exact) return exact.credits;
  const last = milestones.at(-1);
  // Past the final milestone it repeats on every multiple.
  return last && count > last.at && count % last.at === 0 ? last.credits : 0;
}

/** The goal to show next, including how many more friends it needs. */
export function nextMilestone(milestones: Milestone[], count: number): (Milestone & { remaining: number }) | null {
  const upcoming = milestones.find((m) => m.at > count);
  if (upcoming) return { ...upcoming, remaining: upcoming.at - count };
  const last = milestones.at(-1);
  if (!last) return null;
  const at = (Math.floor(count / last.at) + 1) * last.at;
  return { at, credits: last.credits, remaining: at - count };
}

/** Total bonus credits someone has earned at `count` friends, for copy like "1000 credits at 10 friends". */
export function totalCreditsAt(milestones: Milestone[], perReferral: number, count: number): number {
  let total = perReferral * count;
  for (let n = 1; n <= count; n++) total += milestoneBonus(milestones, n);
  return total;
}
