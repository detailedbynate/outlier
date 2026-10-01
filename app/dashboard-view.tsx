import Link from "next/link";
import { Suspense } from "react";
import { greetingName } from "@/lib/analytics/dashboard";
import type { CurrentUser } from "@/lib/auth/session";
import { timeAgo } from "@/lib/format";
import { readSavedNiches } from "@/lib/niches/saved";
import { getServices } from "@/lib/services";
import {
  CompetitorWatchSection,
  CreditsPill,
  HeatingUpSection,
  NichePulseSection,
  PanelSkeleton,
  RecentActivitySection,
  ResearchShortcuts,
  SavedNichesSection,
  TrackedSection,
  YourChannelSection,
  YourChannelSkeleton,
} from "./dashboard/sections";

/** Signed-in home: the day's numbers for your channel and niches. Callers must check access first. Uses stored data only (no YouTube quota). */
export async function DashboardView({ current }: { current: CurrentUser }) {
  const services = getServices();
  const userId = current.user.id;
  const [preferences, lastVisitAt] = await Promise.all([services.onboarding.getPreferences(userId), (current.isTestSession ? Promise.resolve(null) : services.dashboard.registerVisit(userId))]);
  const niches = preferences?.niches ?? [];
  const ownChannel = preferences?.channel ?? null;
  const name = greetingName(current.email, current.user.user_metadata?.full_name as string | undefined);

  return (
    <div className="dash home">
      <header className="dash-hero home-hero">
        <div className="dash-hero-text">
          <h1>Welcome back, {name}</h1>
          <p>{lastVisitAt ? `Here's what moved since you were last here ${timeAgo(lastVisitAt)}.` : "Here's how your channel and your niches are doing."}</p>
        </div>
        <div className="home-hero-side">
          <Suspense fallback={<span className="home-credits sk-block" aria-hidden="true" />}>
            <CreditsPill userId={userId} lastVisitAt={lastVisitAt} />
          </Suspense>
          <Link href="/settings/preferences" className="button-ghost button-small">
            Tune your niches
          </Link>
        </div>
      </header>

      <div className="home-grid">
        <Suspense fallback={<YourChannelSkeleton />}>
          <YourChannelSection userId={userId} ownChannel={ownChannel} />
        </Suspense>

        <Suspense
          fallback={
            <>
              <PanelSkeleton className="home-span-8" rows={5} />
              <PanelSkeleton className="home-span-4" rows={5} />
            </>
          }
        >
          <NichePulseSection niches={niches} lastVisitAt={lastVisitAt} />
        </Suspense>

        <Suspense fallback={<PanelSkeleton className="home-span-7" rows={5} />}>
          <CompetitorWatchSection userId={userId} ownChannel={ownChannel} competitors={preferences?.competitors ?? []} />
        </Suspense>
        <Suspense fallback={<PanelSkeleton className="home-span-5" rows={5} />}>
          <HeatingUpSection niches={niches} lastVisitAt={lastVisitAt} />
        </Suspense>

        <Suspense fallback={null}>
          <SavedNichesSection saved={readSavedNiches(current.user.user_metadata)} />
        </Suspense>

        <Suspense fallback={<PanelSkeleton className="home-span-4" rows={4} />}>
          <TrackedSection userId={userId} ownChannel={ownChannel} />
        </Suspense>
        <Suspense fallback={<PanelSkeleton className="home-span-4" rows={4} />}>
          <RecentActivitySection userId={userId} lastVisitAt={lastVisitAt} />
        </Suspense>
        <ResearchShortcuts isOwner={current.isOwner} />
      </div>
    </div>
  );
}
