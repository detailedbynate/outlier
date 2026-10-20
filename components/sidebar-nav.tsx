"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  ArchiveIcon,
  BookmarkIcon,
  ChartIcon,
  ClipboardIcon,
  CoinsIcon,
  ChevronDownIcon,
  CompassIcon,
  EyeIcon,
  MessageIcon,
  FlameIcon,
  GiftIcon,
  GridIcon,
  LockIcon,
  MicIcon,
  PenIcon,
  PlugIcon,
  SearchIcon,
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

interface NavSection {
  /** Left out for a section that needs no heading. */
  title?: string;
  items: NavItem[];
  /** Only shown while searching. */
  searchOnly?: boolean;
  /** Folds away unless you're on one of its pages or searching. */
  collapsible?: boolean;
}

// Few labels, so the whole menu fits the window without scrolling: Dashboard
// needs no heading, the channel library is research too, and the two tools
// that make something get their own.
const SECTIONS: NavSection[] = [
  { items: [{ href: "/", label: "Dashboard", icon: GridIcon, paid: true }] },
  {
    title: "Research",
    items: [
      { href: "/research/niche-finder", label: "Niche Finder", icon: CompassIcon, paid: true },
      { href: "/research/shorts-channels", label: "Shorts Channels", icon: ShortsIcon },
      { href: "/viral", label: "Viral Videos", icon: FlameIcon, paid: true },
      { href: "/research/removed-channels", label: "Removed Channels", icon: ArchiveIcon, paid: true },
      { href: "/analyze", label: "Analyze Video", icon: ChartIcon, paid: true },
      { href: "/channels", label: "Tracked Channels", icon: BookmarkIcon, paid: true },
      { href: "/compare", label: "Competitors", icon: TargetIcon, paid: true },
    ],
  },
  {
    title: "Create",
    items: [
      { href: "/research/scriptwriter", label: "Script Writer", icon: PenIcon, badge: "New", ownerOnly: true },
      { href: "/voice", label: "Voice Studio", icon: MicIcon, badge: "New", ownerOnly: true },
    ],
  },
  {
    // Lives in the account menu at the bottom; listed here so search still finds these pages.
    title: "Account",
    searchOnly: true,
    items: [
      { href: "/billing", label: "Plans & credits", icon: CoinsIcon },
      { href: "/settings/preferences", label: "Preferences", icon: SlidersIcon },
      { href: "/settings/connect-ai", label: "Connect AI (MCP)", icon: PlugIcon },
      { href: "/referrals", label: "Refer friends", icon: GiftIcon, badge: "Earn" },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

const ADMIN_SECTION: NavSection = {
  title: "Admin",
  collapsible: true,
  items: [
    { href: "/admin/accounts", label: "Accounts", icon: UsersIcon },
    { href: "/admin/waitlist", label: "Waitlist", icon: ClipboardIcon },
    { href: "/admin/creator-codes", label: "Creator codes", icon: GiftIcon },
    { href: "/admin/traffic", label: "Traffic", icon: EyeIcon },
    { href: "/admin/discord", label: "Discord", icon: MessageIcon },
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
  const router = useRouter();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const allSections = isAdmin ? [...SECTIONS, ADMIN_SECTION] : SECTIONS;
  const needle = query.trim().toLowerCase();
  const sections = needle
    ? allSections
        .map((section) => ({ ...section, items: section.items.filter((item) => item.label.toLowerCase().includes(needle)) }))
        .filter((section) => section.items.length > 0)
    : allSections.filter((section) => !section.searchOnly);
  const [folded, setFolded] = useState(true);
  const isOpen = (section: NavSection) =>
    !section.collapsible || Boolean(needle) || !folded || section.items.some((item) => isActive(pathname, item.href));

  // Ctrl+K / Cmd+K jumps to the search box from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <nav className="sidebar-nav" aria-label="Main">
      <label className="sidebar-search">
        <SearchIcon size={15} />
        <input
          ref={searchRef}
          type="search"
          value={query}
          placeholder="Search"
          aria-label="Search pages"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            const first = sections[0]?.items[0];
            if (event.key === "Enter" && first) {
              router.push(first.href);
              setQuery("");
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              setQuery("");
              event.currentTarget.blur();
            }
          }}
        />
        <kbd>Ctrl K</kbd>
      </label>
      {sections.length === 0 ? <p className="sidebar-search-empty">No pages match</p> : null}
      {sections.map((section) => (
        <div key={section.title ?? section.items[0]?.href} className="nav-section">
          {section.collapsible && !needle ? (
            <button type="button" className="nav-section-title nav-section-toggle" aria-expanded={isOpen(section)} onClick={() => setFolded(isOpen(section))}>
              {section.title}
              <ChevronDownIcon size={13} />
            </button>
          ) : section.title ? (
            <div className="nav-section-title">{section.title}</div>
          ) : null}
          {(isOpen(section) ? section.items : []).map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            // Locked items say so in their own colour: this is about access, not novelty.
            const proLocked = freePlan && (item.paid === true || item.ownerOnly === true);
            const locked = proLocked || (item.ownerOnly === true && !writerOpen);
            const badge = proLocked ? "Pro" : locked ? "Soon" : item.badge;
            return (
              <Link key={item.href} href={item.href} className="nav-link" onClick={() => setQuery("")} aria-current={active ? "page" : undefined}>
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
