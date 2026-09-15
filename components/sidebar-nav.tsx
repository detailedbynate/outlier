"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { BookmarkIcon, ChartIcon, CompassIcon, FlameIcon, GridIcon, ShortsIcon, SlidersIcon, UsersIcon } from "./icons";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  badge?: string;
}

const SECTIONS: { title: string; items: NavItem[] }[] = [
  { title: "Overview", items: [{ href: "/", label: "Dashboard", icon: GridIcon }] },
  {
    title: "Research tools",
    items: [
      { href: "/research/niche-finder", label: "Niche Finder", icon: CompassIcon, badge: "New" },
      { href: "/research/shorts-channels", label: "Shorts Channels", icon: ShortsIcon },
      { href: "/viral", label: "Viral Videos", icon: FlameIcon },
      { href: "/analyze", label: "Analyze Video", icon: ChartIcon },
    ],
  },
  {
    title: "Library",
    items: [
      { href: "/channels", label: "Tracked Channels", icon: BookmarkIcon },
      { href: "/compare", label: "Competitors", icon: UsersIcon, badge: "New" },
    ],
  },
  { title: "Account", items: [{ href: "/settings/preferences", label: "Preferences", icon: SlidersIcon }] },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

const ADMIN_SECTION: { title: string; items: NavItem[] } = {
  title: "Admin",
  items: [
    { href: "/admin/accounts", label: "Accounts", icon: UsersIcon },
    { href: "/admin/waitlist", label: "Waitlist", icon: UsersIcon },
  ],
};

export function SidebarNav({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const sections = isAdmin ? [...SECTIONS, ADMIN_SECTION] : SECTIONS;
  return (
    <nav className="sidebar-nav" aria-label="Main">
      {sections.map((section) => (
        <div key={section.title} className="nav-section">
          <div className="nav-section-title">{section.title}</div>
          {section.items.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className="nav-link" aria-current={active ? "page" : undefined}>
                <span className="nav-icon">
                  <Icon size={17} />
                </span>
                <span className="nav-label">{item.label}</span>
                {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
