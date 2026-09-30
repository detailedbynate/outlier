/**
 * The "What's new" popup. Bump `id` when there's something new to announce:
 * everyone who hasn't seen that version gets the popup once, on whatever page
 * they open next. The owner can also show it to everyone again from
 * /admin/accounts, which bumps the version without a deploy (see
 * lib/changelog-version.ts). Accounts created after `date` skip it.
 */
export const CHANGELOG = {
  id: "2026-09-29.2",
  date: "2026-09-29",
  title: "What's new in Outlier",
  items: [
    {
      title: "Script Writer is here",
      body: "Give it your niche and an idea and it writes the script: hook, turn, payoff, ready to read out. Show it a couple of your scripts and it writes in your voice. On Pro and Expert.",
    },
    {
      title: "A new dashboard",
      body: "Your channel comes first now: subscriber growth, a views-per-upload chart that marks your best video, and how you stack up against your competitors.",
    },
    {
      title: "Fresher data",
      body: "Channels that are actively posting get checked daily, so new breakouts show up sooner.",
    },
    {
      title: "Forgot your password?",
      body: "You can reset it yourself from the sign-in page. We'll email you a link.",
    },
  ],
} as const;

export const CHANGELOG_SEEN_KEY = "changelog_seen";

/** Whether this account should see the changelog at `version`. */
export function shouldShowChangelog(user: { created_at?: string; user_metadata?: Record<string, unknown> }, version: string): boolean {
  if (user.user_metadata?.[CHANGELOG_SEEN_KEY] === version) return false;
  // New accounts are already looking at all of it.
  if (user.created_at && user.created_at.slice(0, 10) >= CHANGELOG.date) return false;
  return true;
}
