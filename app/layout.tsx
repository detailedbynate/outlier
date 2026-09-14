import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { CreditsMeter } from "@/components/credits-meter";
import { BrandMark, LogOutIcon } from "@/components/icons";
import { SidebarNav } from "@/components/sidebar-nav";
import { getCurrentUser } from "@/lib/auth/session";
import { getServices } from "@/lib/services";
import { signOut } from "./login/actions";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

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
      <html lang="en" className={inter.variable}>
        <body>
          <div className="ambient" aria-hidden="true" />
          <div className="shell">
            <header className="topbar">
              <Brand />
            </header>
            {children}
          </div>
        </body>
      </html>
    );
  }

  const credits = await getServices().credits.status(current.user.id);

  return (
    <html lang="en" className={inter.variable}>
      <body>
        <div className="ambient" aria-hidden="true" />
        <div className="app">
          <aside className="sidebar glass">
            <Brand />
            <SidebarNav />
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
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
