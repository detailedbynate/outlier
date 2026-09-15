import { describe, expect, it } from "vitest";
import { milestoneBonus, nextMilestone, parseMilestones, totalCreditsAt } from "@/lib/referrals/milestones";

const PER_REFERRAL = 25;
const MILESTONES = parseMilestones("1:75,3:100,5:200,10:375");

describe("referral milestones", () => {
  it("parses and sorts pairs, skipping junk", () => {
    expect(MILESTONES).toEqual([
      { at: 1, credits: 75 },
      { at: 3, credits: 100 },
      { at: 5, credits: 200 },
      { at: 10, credits: 375 },
    ]);
    expect(parseMilestones("5:200, 1:75")).toEqual([
      { at: 1, credits: 75 },
      { at: 5, credits: 200 },
    ]);
    expect(parseMilestones("nonsense,0:50,2:-5")).toEqual([]);
  });

  it("pays the advertised running totals", () => {
    expect(totalCreditsAt(MILESTONES, PER_REFERRAL, 1)).toBe(100);
    expect(totalCreditsAt(MILESTONES, PER_REFERRAL, 3)).toBe(250);
    expect(totalCreditsAt(MILESTONES, PER_REFERRAL, 5)).toBe(500);
    expect(totalCreditsAt(MILESTONES, PER_REFERRAL, 10)).toBe(1000);
  });

  it("only pays on the milestone itself, then repeats the last one", () => {
    expect(milestoneBonus(MILESTONES, 2)).toBe(0);
    expect(milestoneBonus(MILESTONES, 5)).toBe(200);
    expect(milestoneBonus(MILESTONES, 20)).toBe(375);
    expect(milestoneBonus(MILESTONES, 25)).toBe(0);
  });

  it("always has a next goal", () => {
    expect(nextMilestone(MILESTONES, 0)).toEqual({ at: 1, credits: 75, remaining: 1 });
    expect(nextMilestone(MILESTONES, 3)).toEqual({ at: 5, credits: 200, remaining: 2 });
    expect(nextMilestone(MILESTONES, 12)).toEqual({ at: 20, credits: 375, remaining: 8 });
    expect(nextMilestone([], 4)).toBeNull();
  });
});
