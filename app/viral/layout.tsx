import type { ReactNode } from "react";
import { Suspense } from "react";
import { FlameIcon } from "@/components/icons";
import { requireApprovedUser } from "@/lib/auth/session";
import { paidFeaturesLocked } from "@/lib/billing/feature-gate";
import { ANGLES, HOOK_TYPES, VIDEO_STYLES } from "@/lib/breakdowns/taxonomy";
import { ViralFilters, type TermGroup } from "./filters";

/** Plain label lists for the "What worked" pickers, so the client bundle skips the taxonomy module. */
const terms = (param: TermGroup["param"], label: string, source: Record<string, { label: string; description: string }>): TermGroup => ({
  param,
  label,
  options: Object.entries(source)
    .filter(([key]) => key !== "other")
    .map(([key, term]) => ({ key, label: term.label, description: term.description })),
});

const GROUPS: TermGroup[] = [terms("style", "Style", VIDEO_STYLES), terms("hook", "Hook", HOOK_TYPES), terms("angle", "Angle", ANGLES)];

/**
 * The header and filters sit in the layout so they stay put while the videos
 * reload: a new filter lights up the moment it's clicked and only the grid
 * below waits.
 */
export default async function ViralLayout({ children }: { children: ReactNode }) {
  const current = await requireApprovedUser();
  // Locked accounts get the page's paywall on its own.
  if (await paidFeaturesLocked(current)) return children;
  return (
    <div className="stack vv">
      <header className="dash-hero vv-hero">
        <div className="dash-hero-text">
          <span className="dash-eyebrow">
            <FlameIcon size={13} /> Find
          </span>
          <h1>Viral Videos</h1>
          <p>Videos ranked by how far they beat their own channel&apos;s usual views. Click one to watch it here, and see what the winners have in common.</p>
        </div>
      </header>
      <Suspense fallback={<div className="vv-bar" aria-hidden="true" />}>
        <ViralFilters groups={GROUPS} />
      </Suspense>
      {children}
    </div>
  );
}
