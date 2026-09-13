import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth/session";
import { signOut } from "./login/actions";
import "./globals.css";

export const metadata: Metadata = {
  title: "Outlier",
  description: "YouTube intelligence: viral videos, channel tracking, and analysis",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const current = await getCurrentUser();
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <Link href="/" className="brand">
              Outlier
            </Link>
            {current?.approved ? (
              <nav className="nav">
                <Link href="/">Dashboard</Link>
                <Link href="/viral">Viral videos</Link>
                <Link href="/channels">Channels</Link>
                <Link href="/analyze">Analyze video</Link>
              </nav>
            ) : null}
            {current ? (
              <form action={signOut} className="account">
                <span className="muted">{current.email}</span>
                <button type="submit" className="button-ghost">
                  Sign out
                </button>
              </form>
            ) : null}
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
