"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { ChartIcon, CompassIcon, FlameIcon, GridIcon } from "./icons";
import { isActive } from "./nav-items";

/** The pages a phone reaches with one thumb; everything else is a tap on Menu away. */
const TABS: { href: string; label: string; icon: ComponentType<{ size?: number }> }[] = [
  { href: "/", label: "Home", icon: GridIcon },
  { href: "/research/niche-finder", label: "Niches", icon: CompassIcon },
  { href: "/viral", label: "Viral", icon: FlameIcon },
  { href: "/analyze", label: "Analyze", icon: ChartIcon },
];

/**
 * Phone-only bar along the bottom of every app page. Menu opens the full
 * sidebar (the same one desktop shows) through its own toggle, so there's one
 * menu to keep in step. Hidden on desktop.
 */
export function MobileTabBar() {
  const pathname = usePathname();
  const onTab = TABS.some((tab) => isActive(pathname, tab.href));

  return (
    <nav className="mobile-tabs" aria-label="Main">
      {TABS.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} className="mobile-tab" aria-current={isActive(pathname, href) ? "page" : undefined}>
          <Icon size={21} />
          <span>{label}</span>
        </Link>
      ))}
      <button
        type="button"
        className="mobile-tab"
        aria-current={onTab ? undefined : "page"}
        aria-controls="app-sidebar-menu"
        onClick={() => document.querySelector<HTMLButtonElement>(".mobile-menu-toggle")?.click()}
      >
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h10" />
        </svg>
        <span>Menu</span>
      </button>
    </nav>
  );
}
