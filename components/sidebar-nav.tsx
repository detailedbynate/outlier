"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, LockIcon, SearchIcon, ZapIcon } from "./icons";
import { ACCOUNT, ADMIN, MAIN, isActive, isGroup, type NavItem } from "./nav-items";

export interface SidebarCredits {
  remaining: number;
  limit: number;
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
