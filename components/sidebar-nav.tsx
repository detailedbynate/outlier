"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import {
  BookmarkIcon,
  ChartIcon,
  ClipboardIcon,
  CoinsIcon,
  CompassIcon,
  FlameIcon,
  GiftIcon,
  GridIcon,
  LockIcon,
  PenIcon,
  ShortsIcon,
  SlidersIcon,
  TargetIcon,
  UsersIcon,
} from "./icons";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  badge?: string;
  /** Open to the owner and plans that include it; everyone else sees it badged, and lands on the locked preview. */
  ownerOnly?: boolean;
  /** Not on Free: shown with a Pro lock there, and the page is a paywall. */
  paid?: boolean;
}

const SECTIONS: { title: string; items: NavItem[] }[] = [
  { title: "Overview", items: [{ href: "/", label: "Dashboard", icon: GridIcon, paid: true }] },
  {
    title: "Research tools",
    items: [
      { href: "/research/niche-finder", label: "Niche Finder", icon: CompassIcon, paid: true },
      { href: "/research/shorts-channels", label: "Shorts Channels", icon: ShortsIcon },
      { href: "/viral", label: "Viral Videos", icon: FlameIcon, paid: true },
      { href: "/analyze", label: "Analyze Video", icon: ChartIcon, paid: true },
      { href: "/research/scriptwriter", label: "Script Writer", icon: PenIcon, badge: "New", ownerOnly: true },
    ],
  },
  {
    title: "Library",
    items: [
      { href: "/channels", label: "Tracked Channels", icon: BookmarkIcon, paid: true },
      { href: "/compare", label: "Competitors", icon: TargetIcon, paid: true },
    ],
  },
  {
    title: "Account",
    items: [
      { href: "/billing", label: "Plans & credits", icon: CoinsIcon },
      { href: "/settings/preferences", label: "Preferences", icon: SlidersIcon },
      { href: "/referrals", label: "Refer friends", icon: GiftIcon, badge: "Earn" },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

const ADMIN_SECTION: { title: string; items: NavItem[] } = {
  title: "Admin",
  items: [
    { href: "/admin/accounts", label: "Accounts", icon: UsersIcon },
    { href: "/admin/waitlist", label: "Waitlist", icon: ClipboardIcon },
  ],
};

export function SidebarNav({
  isAdmin = false,
  isOwner = false,
  writerOpen = isOwner,
  freePlan = false,
}: {
  isAdmin?: boolean;
  isOwner?: boolean;
  writerOpen?: boolean;
  /** On Free, every paid tool shows a Pro lock. */
  freePlan?: boolean;
}) {
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
            // Locked items say so in their own colour: this is about access, not novelty.
            const proLocked = freePlan && (item.paid === true || item.ownerOnly === true);
            const locked = proLocked || (item.ownerOnly === true && !writerOpen);
            const badge = proLocked ? "Pro" : locked ? "Soon" : item.badge;
            return (
              <Link key={item.href} href={item.href} className="nav-link" aria-current={active ? "page" : undefined}>
                <span className="nav-icon">
                  <Icon size={17} />
                </span>
                <span className="nav-label">{item.label}</span>
                {badge ? (
                  <span className="nav-badge" data-variant={locked ? "soon" : undefined} title={proLocked ? "On Pro and Expert" : locked ? "Coming soon" : undefined}>
                    {locked ? <LockIcon size={10} /> : null}
                    {badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
