import Link from "next/link";
import { Suspense } from "react";
import { greetingName } from "@/lib/analytics/dashboard";
import type { CurrentUser } from "@/lib/auth/session";
import { timeAgo } from "@/lib/format";
import { getServices } from "@/lib/services";
import {
  CompetitorWatchSection,
  NichePulseSection,
  OverviewStats,
  PanelSkeleton,
  RecentActivitySection,
  ResearchShortcuts,
  YourChannelsSection,
} from "./dashboard/sections";

/** Signed-in home: a daily command center. Callers must check access first. Uses stored data only (no YouTube quota). */
export async function DashboardView({ current }: { current: CurrentUser }) {
  const services = getServices();
  const userId = current.user.id;
  const [preferences, lastVisitAt] = await Promise.all([services.onboarding.getPreferences(userId), (current.isTestSession ? Promise.resolve(null) : services.dashboard.registerVisit(userId))]);
  const niches = preferences?.niches ?? [];
  const name = greetingName(current.email, current.user.user_metadata?.full_name as string | undefined);

  return (
    <div className="dash">
      <header className="dash-hero">
        <div className="dash-hero-text">
          <span className="dash-eyebrow">
            <span className="dash-live" aria-hidden="true" />
            Command center
          </span>
          <h1>Welcome back, {name}</h1>
          <p>
            {lastVisitAt ? `Here's what moved since you were last here ${timeAgo(lastVisitAt)}.` : "Here's what's moving in your space right now."}{" "}
            <Link href="/settings/preferences" className="dash-link">
              Tune your niches
            </Link>
          </p>
        </div>
        <Suspense fallback={<div className="dash-stats dash-stats-loading" aria-hidden="true">{[0, 1, 2, 3].map((i) => <span key={i} className="dash-stat sk-block" />)}</div>}>
          <OverviewStats userId={userId} lastVisitAt={lastVisitAt} niches={niches.length} />
        </Suspense>
      </header>

      <Suspense fallback={<PanelSkeleton className="dash-pulse" rows={4} />}>
        <NichePulseSection niches={niches} lastVisitAt={lastVisitAt} />
      </Suspense>

      <div className="dash-columns">
        <Suspense fallback={<PanelSkeleton rows={4} />}>
          <YourChannelsSection ownChannel={preferences?.channel ?? null} />
        </Suspense>
        <Suspense fallback={<PanelSkeleton rows={4} />}>
          <CompetitorWatchSection competitors={preferences?.competitors ?? []} />
        </Suspense>
      </div>

      <div className="dash-columns dash-columns-bottom">
        <section className="dash-panel dash-shortcuts-panel" style={{ "--i": 3 } as React.CSSProperties} aria-label="Research shortcuts">
          <header className="dash-panel-head">
            <div className="dash-panel-titles">
              <h2>Research shortcuts</h2>
              <p>Jump straight into a tool</p>
            </div>
          </header>
          <ResearchShortcuts />
        </section>
        <Suspense fallback={<PanelSkeleton rows={3} />}>
          <RecentActivitySection userId={userId} />
        </Suspense>
      </div>
    </div>
  );
}
