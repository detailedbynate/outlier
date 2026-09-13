import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { SidebarNav } from "@/components/sidebar-nav";
import { getCurrentUser } from "@/lib/auth/session";
import { signOut } from "./login/actions";
import "./globals.css";

export const metadata: Metadata = {
  title: "Outlier",
  description: "YouTube intelligence: viral videos, channel research, and analysis",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const current = await getCurrentUser();

  if (!current?.approved) {
    return (
      <html lang="en">
        <body>
          <div className="shell">
            <header className="topbar">
              <Link href="/" className="brand">
                Outlier
              </Link>
            </header>
            {children}
          </div>
        </body>
      </html>
    );
  }

  return (
    <html lang="en">
      <body>
        <div className="app">
          <aside className="sidebar">
            <Link href="/" className="brand">
              Outlier
            </Link>
            <SidebarNav />
            <form action={signOut} className="sidebar-account">
              <span className="muted" title={current.email}>
                {current.email}
              </span>
              <button type="submit" className="button-ghost">
                Sign out
              </button>
            </form>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
