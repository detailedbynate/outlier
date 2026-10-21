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
  ZapIcon,
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

/** A heading that folds its pages away, like Algrow's menu. */
interface NavGroup {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  items: NavItem[];
}

type NavEntry = NavItem | NavGroup;

const isGroup = (entry: NavEntry): entry is NavGroup => "items" in entry;

const MAIN: NavEntry[] = [
  { href: "/", label: "Dashboard", icon: GridIcon, paid: true },
  {
    id: "research",
    label: "Research Tools",
    icon: CompassIcon,
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
    id: "create",
    label: "Creation Tools",
    icon: PenIcon,
    items: [
      { href: "/research/scriptwriter", label: "Script Writer", icon: PenIcon, badge: "New", ownerOnly: true },
      { href: "/voice", label: "Voice Studio", icon: MicIcon, badge: "New", ownerOnly: true },
    ],
  },
  { href: "/settings/connect-ai", label: "Connect AI (MCP)", icon: PlugIcon, badge: "New" },
];

const ADMIN: NavGroup = {
  id: "admin",
  label: "Admin",
  icon: UsersIcon,
  items: [
    { href: "/admin/accounts", label: "Accounts", icon: UsersIcon },
    { href: "/admin/waitlist", label: "Waitlist", icon: ClipboardIcon },
    { href: "/admin/creator-codes", label: "Creator codes", icon: GiftIcon },
    { href: "/admin/traffic", label: "Traffic", icon: EyeIcon },
    { href: "/admin/discord", label: "Discord", icon: MessageIcon },
  ],
};

/** The account pages, listed at the bottom of the menu rather than behind the dots. */
const ACCOUNT: NavItem[] = [
  { href: "/referrals", label: "Refer friends", icon: GiftIcon, badge: "Earn" },
  { href: "/billing", label: "Credits", icon: CoinsIcon },
  { href: "/settings/preferences", label: "Preferences", icon: SlidersIcon },
];

export interface SidebarCredits {
  remaining: number;
  limit: number;
}

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** What the credits row says on its right: the balance, or that there's no limit. */
function creditsLabel(credits: SidebarCredits): { text: string; level: "ok" | "low" | "empty" } {
  if (credits.limit >= 1_000_000) return { text: "Unlimited", level: "ok" };
  const share = credits.limit === 0 ? 0 : credits.remaining / credits.limit;
  return { text: `${credits.remaining.toLocaleString("en-US")} left`, level: credits.remaining <= 0 ? "empty" : share <= 0.2 ? "low" : "ok" };
}

export function SidebarNav({
  isAdmin = false,
  isOwner = false,
  writerOpen = isOwner,
  freePlan = false,
  credits,
}: {
  isAdmin?: boolean;
  isOwner?: boolean;
  writerOpen?: boolean;
  /** On Free, every paid tool shows a Pro lock. */
  freePlan?: boolean;
  credits?: SidebarCredits;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const main = isAdmin ? [...MAIN, ADMIN] : MAIN;
  const groups = main.filter(isGroup);
  // One group open at a time, so the menu always fits the window: the one holding
  // the page you're on, or Research Tools on a page in none.
  const activeGroup = groups.find((group) => group.items.some((item) => isActive(pathname, item.href)))?.id ?? null;
  const [open, setOpen] = useState<string | null>(activeGroup ?? "research");
  // Moving into a folded group opens it, so the page you're on is always in view.
  const [openedFor, setOpenedFor] = useState(activeGroup);
  if (openedFor !== activeGroup) {
    setOpenedFor(activeGroup);
    if (activeGroup) setOpen(activeGroup);
  }
  const toggle = (id: string) => setOpen(open === id ? null : id);

  const needle = query.trim().toLowerCase();
  const everything = [...main.flatMap((entry) => (isGroup(entry) ? entry.items : [entry])), ...ACCOUNT];
  const matches = needle ? everything.filter((item) => item.label.toLowerCase().includes(needle)) : [];

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

  const link = (item: NavItem, extra?: { value?: string; level?: string }) => {
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
        {extra?.value ? (
          <span className="nav-value" data-level={extra.level}>
            {extra.value}
          </span>
        ) : null}
        {badge ? (
          <span className="nav-badge" data-variant={locked ? "soon" : undefined} title={proLocked ? "On Pro and Expert" : locked ? "Coming soon" : undefined}>
            {locked ? <LockIcon size={10} /> : null}
            {badge}
          </span>
        ) : null}
      </Link>
    );
  };

  const credit = credits ? creditsLabel(credits) : null;

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
            const first = matches[0];
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

      {needle ? (
        <div className="nav-section">
          {matches.length === 0 ? <p className="sidebar-search-empty">No pages match</p> : matches.map((item) => link(item))}
        </div>
      ) : (
        <>
          <div className="nav-section">
            {main.map((entry) => {
              if (!isGroup(entry)) return link(entry);
              const expanded = open === entry.id;
              const GroupIcon = entry.icon;
              return (
                <div key={entry.id} className="nav-group" data-open={expanded || undefined}>
                  <button type="button" className="nav-link nav-group-toggle" aria-expanded={expanded} onClick={() => toggle(entry.id)}>
                    <span className="nav-icon">
                      <GroupIcon size={17} />
                    </span>
                    <span className="nav-label">{entry.label}</span>
                    <span className="nav-chevron">
                      <ChevronDownIcon size={14} />
                    </span>
                  </button>
                  {expanded ? <div className="nav-sub">{entry.items.map((item) => link(item))}</div> : null}
                </div>
              );
            })}
          </div>

          <div className="nav-section nav-account">
            <div className="nav-section-title">Account</div>
            {freePlan ? link({ href: "/billing#plans", label: "Upgrade plan", icon: ZapIcon, badge: "Pro" }) : null}
            {ACCOUNT.map((item) => (item.href === "/billing" && credit ? link(item, { value: credit.text, level: credit.level }) : freePlan && item.href === "/billing" ? null : link(item)))}
          </div>
        </>
      )}
    </nav>
  );
}
