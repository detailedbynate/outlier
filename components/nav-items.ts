import type { ComponentType } from "react";
import {
  ArchiveIcon,
  BookmarkIcon,
  ChartIcon,
  ClipboardIcon,
  CoinsIcon,
  CompassIcon,
  EyeIcon,
  MessageIcon,
  FlameIcon,
  GiftIcon,
  GridIcon,
  MicIcon,
  PenIcon,
  PlugIcon,
  ShortsIcon,
  SlidersIcon,
  TargetIcon,
  UsersIcon,
} from "./icons";

// Every page in the app menu: the sidebar lists them and the top bar names the one you're on.

export interface NavItem {
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
export interface NavGroup {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  items: NavItem[];
}

export type NavEntry = NavItem | NavGroup;

export const isGroup = (entry: NavEntry): entry is NavGroup => "items" in entry;

export const MAIN: NavEntry[] = [
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
  { href: "/settings/connect-ai", label: "Connect AI", icon: PlugIcon, badge: "New" },
];

export const ADMIN: NavGroup = {
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
export const ACCOUNT: NavItem[] = [
  { href: "/referrals", label: "Refer friends", icon: GiftIcon, badge: "Earn" },
  { href: "/billing", label: "Credits", icon: CoinsIcon },
  { href: "/settings/preferences", label: "Preferences", icon: SlidersIcon },
];

export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** The menu entry for the page at `pathname` (deeper pages count as theirs), and the group it sits in. */
export function pageFor(pathname: string, isAdmin: boolean): { item: NavItem; group: NavGroup | null } | null {
  const main = isAdmin ? [...MAIN, ADMIN] : MAIN;
  for (const entry of [...main, ...ACCOUNT]) {
    if (isGroup(entry)) {
      const item = entry.items.find((candidate) => isActive(pathname, candidate.href));
      if (item) return { item, group: entry };
    } else if (isActive(pathname, entry.href)) {
      return { item: entry, group: null };
    }
  }
  return null;
}
