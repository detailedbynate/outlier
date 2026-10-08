import type { Metadata } from "next";
import { DM_Sans, Schibsted_Grotesk } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { CreditsMeter, type SidebarPlan } from "@/components/credits-meter";
import { LowCreditsPrompt } from "@/components/low-credits-prompt";
import { LOW_CREDITS_THRESHOLD } from "@/lib/services/credits-service";
import { BrandMark, LogOutIcon } from "@/components/icons";
import { MobileMenuToggle } from "@/components/mobile-menu-toggle";
import { SidebarNav } from "@/components/sidebar-nav";
import { SiteTracker } from "@/components/site-tracker";
import { TrialReminder, type TrialReminderProps } from "@/components/trial-reminder";
import { WhatsNew } from "@/components/whats-new";
import { findPlan } from "@/lib/billing/plans";
import { priceIdFor } from "@/lib/billing/subscriptions";
import { offerOpen, reminderEvery, TRIAL_OFFER, type Trial } from "@/lib/billing/trial";
import { formatPrice } from "@/lib/billing/packs";
import { shouldShowChangelog } from "@/lib/changelog";
import { currentChangelogVersion } from "@/lib/changelog-version";
import { getCurrentUser } from "@/lib/auth/session";
import { getServices } from "@/lib/services";
import { signOut } from "./login/actions";
import "./globals.css";
import { writerOpenTo } from "@/lib/scripts/access";

const dmSans = DM_Sans({ subsets: ["latin"], display: "swap", variable: "--font-sans" });
// Small labels in the signed-in app (menu sections, table headings); body text stays DM Sans.
const appFont = Schibsted_Grotesk({ subsets: ["latin"], display: "swap", variable: "--font-app" });

export const metadata: Metadata = {
  title: "Outlier",
  description: "YouTube intelligence: find breakout Shorts channels, viral videos, and what's working.",
};

function Brand() {
  return (
    <Link href="/" className="brand">
      <BrandMark size={28} />
      <span>Outlier</span>
    </Link>
  );
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const current = await getCurrentUser();

  if (!current?.approved) {
    return (
      <html lang="en" className={dmSans.variable}>
        <body>
          <div className="ambient" aria-hidden="true" />
          <div className="shell">
            <header className="topbar">
              <Brand />
              <nav className="topbar-actions">
                {current ? (
                  <form action={signOut}>
                    <button type="submit" className="button-ghost">
                      Sign out
                    </button>
                  </form>
                ) : (
                  <Link href="/login" className="topbar-link">
                    Sign in
                  </Link>
                )}
              </nav>
            </header>
            {children}
          </div>
          <SiteTracker signedIn={Boolean(current)} />
        </body>
      </html>
    );
  }

  const [credits, subscription, changelogVersion] = await Promise.all([
    getServices().credits.status(current.user.id),
    // A plan lookup that fails shouldn't take the sidebar down; the chip just doesn't show.
    current.isOwner ? null : getServices().subscriptions.stateFor(current.user.id).catch(() => null),
    currentChangelogVersion(),
  ]);
  // One popup at a time: the changelog goes first, the credits prompt can wait a page.
  const showChangelog = current.onboardingCompleted && shouldShowChangelog(current.user, changelogVersion);
  const trialReminder = showChangelog ? null : trialReminderFor(subscription?.trial ?? null);
  const plan: SidebarPlan | undefined = current.isOwner ? "owner" : subscription ? subscription.plan.id : undefined;

  return (
    <html lang="en" className={`${dmSans.variable} ${appFont.variable}`}>
      <body className="app-body">
        <div className="ambient" aria-hidden="true" />
        <div className="app">
          <aside className="sidebar glass">
            <Brand />
            <MobileMenuToggle />
            <div id="app-sidebar-menu" className="sidebar-menu">
            <SidebarNav isAdmin={current.isAdmin} isOwner={current.isOwner} writerOpen={writerOpenTo(subscription?.plan.id, current.isOwner)} freePlan={!current.isAdmin && subscription?.plan.priceCents === 0} />
            <div className="sidebar-foot">
              <CreditsMeter status={credits} plan={plan} />
              <form action={signOut} className="sidebar-account">
                <span className="account-avatar" aria-hidden="true">
                  {current.email.slice(0, 1).toUpperCase()}
                </span>
                <span className="account-email" title={current.email}>
                  {current.email}
                </span>
                <button type="submit" className="icon-button" aria-label="Sign out" title="Sign out">
                  <LogOutIcon size={15} />
                </button>
              </form>
            </div>
            </div>
          </aside>
          <main className="main">
            {current.moderation.status === "restricted" ? (
              <div className="restricted-banner" role="status">
                Your account is restricted
                {current.moderation.until ? ` until ${new Date(current.moderation.until).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}` : ""}. You can browse, but
                actions that use credits or YouTube data are paused.
                {current.moderation.reason ? ` Reason: ${current.moderation.reason}` : ""}
              </div>
            ) : null}
            {children}
          </main>
          {showChangelog ? <WhatsNew version={changelogVersion} /> : null}
          {trialReminder ? <TrialReminder {...trialReminder} /> : null}
          {!showChangelog && !trialReminder && credits.limit < 1_000_000 && current.moderation.status !== "restricted" ? (
            <LowCreditsPrompt remaining={credits.remaining} threshold={LOW_CREDITS_THRESHOLD} month={credits.resetsAt.slice(0, 7)} />
          ) : null}
        </div>
        {current.isAdmin ? null : <SiteTracker signedIn />}
      </body>
    </html>
  );
}

/** The trial reminder's props, or null when there's nothing to remind them of yet. */
function trialReminderFor(trial: Trial | null): TrialReminderProps | null {
  if (!trial) return null;
  const now = Date.now();
  const everyMs = reminderEvery(trial, now);
  if (everyMs === null) return null;
  const expert = findPlan(TRIAL_OFFER.planId)!;
  const offer =
    offerOpen(trial, now) && priceIdFor(expert) !== null
      ? {
          price: formatPrice(TRIAL_OFFER.priceCents),
          was: formatPrice(expert.priceCents),
          months: TRIAL_OFFER.months,
          until: new Date(Date.parse(trial.endsAt) + TRIAL_OFFER.graceMs).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        }
      : null;
  return { planName: findPlan(trial.planId)!.name, endsAt: trial.endsAt, everyMs, offer };
}
