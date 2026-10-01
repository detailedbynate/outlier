/**
 * What the Free plan opens. Free is Shorts Channels and nothing else: every
 * other tool is still in the menu and still has its page, but the page is a
 * paywall over a preview. Pro and Expert (trials included) open everything.
 *
 * Pages check this before they load any data, and the actions behind those
 * pages check it again, so a locked tool never spends credits or quota.
 */

export type PaidFeature = "dashboard" | "niche-finder" | "viral" | "analyze" | "tracked" | "competitors";

export interface FeatureCopy {
  title: string;
  /** One line on what it does for them. */
  pitch: string;
  /** What's behind the lock, three short lines. */
  points: readonly string[];
}

export const PAID_FEATURES: Record<PaidFeature, FeatureCopy> = {
  dashboard: {
    title: "Dashboard",
    pitch: "Your channel, your competitors and the niches you're watching, on one page every morning.",
    points: ["Subscriber growth and views per upload for your channel", "You against your competitors, side by side", "Channels heating up in your niche this week"],
  },
  "niche-finder": {
    title: "Niche Finder",
    pitch: "Score any niche on demand, growth and competition before you film a single Short.",
    points: ["An opportunity score with what it's made of", "What the breakout uploads have in common", "Save niches and compare them side by side"],
  },
  viral: {
    title: "Viral Videos",
    pitch: "The Shorts pulling far more views than their channel normally gets, as they happen.",
    points: ["Outliers ranked by how far they beat their channel", "Filter by niche, size and how recent", "See the pattern before everyone copies it"],
  },
  analyze: {
    title: "Analyze Video",
    pitch: "Paste any Short and see exactly why it worked, measured against its own channel.",
    points: ["Rank, reach and engagement against the channel's usual", "Packaging: title, length, hashtags, posting time", "Views over time and what stands out"],
  },
  tracked: {
    title: "Tracked Channels",
    pitch: "Keep the channels you care about in one place, refreshed for you.",
    points: ["Growth and uploads for every channel you track", "New breakouts flagged as they land", "Your own library of channels to learn from"],
  },
  competitors: {
    title: "Competitors",
    pitch: "Watch the channels you're up against and know the moment one of them breaks out.",
    points: ["Their uploads, views and growth next to yours", "Alerts when a competitor's video takes off", "Where you're ahead and where you're behind"],
  },
};

/** Free opens Shorts Channels only; any paid plan (or a trial of one) opens everything. */
export function opensPaidFeatures(planPriceCents: number, isAdmin: boolean): boolean {
  return isAdmin || planPriceCents > 0;
}
