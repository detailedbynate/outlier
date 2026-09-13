import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Outlier",
  description: "YouTube intelligence: viral videos, channel tracking, and analysis",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <Link href="/" className="brand">
              Outlier
            </Link>
            <nav className="nav">
              <Link href="/">Dashboard</Link>
              <Link href="/viral">Viral videos</Link>
              <Link href="/channels">Channels</Link>
              <Link href="/analyze">Analyze video</Link>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
