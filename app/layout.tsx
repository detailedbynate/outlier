import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { CreditsMeter } from "@/components/credits-meter";
import { LowCreditsPrompt } from "@/components/low-credits-prompt";
import { LOW_CREDITS_THRESHOLD } from "@/lib/services/credits-service";
import { BrandMark, LogOutIcon } from "@/components/icons";
import { MobileMenuToggle } from "@/components/mobile-menu-toggle";
import { SidebarNav } from "@/components/sidebar-nav";
import { getCurrentUser } from "@/lib/auth/session";
import { getServices } from "@/lib/services";
import { signOut } from "./login/actions";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], display: "swap", variable: "--font-sans" });

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
      <html lang="en" className={geist.variable}>
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
        </body>
      </html>
    );
  }

  const credits = await getServices().credits.status(current.user.id);

  return (
    <html lang="en" className={geist.variable}>
      <body>
        <div className="ambient" aria-hidden="true" />
        <div className="app">
          <aside className="sidebar glass">
            <Brand />
            <MobileMenuToggle />
            <div id="app-sidebar-menu" className="sidebar-menu">
            <SidebarNav isAdmin={current.isAdmin} />
            <div className="sidebar-foot">
              <CreditsMeter status={credits} />
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
          {credits.limit < 1_000_000 && current.moderation.status !== "restricted" ? (
            <LowCreditsPrompt remaining={credits.remaining} threshold={LOW_CREDITS_THRESHOLD} month={credits.resetsAt.slice(0, 7)} />
          ) : null}
        </div>
      </body>
    </html>
  );
}
