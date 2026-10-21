"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { markChangelogSeen } from "@/app/changelog-actions";
import { CHANGELOG, CHANGELOG_SEEN_EVENT, changelogStorageKey } from "@/lib/changelog";
import { ACCOUNT_LINKS } from "./account-menu";
import { BellIcon, ChevronRightIcon, LogOutIcon } from "./icons";
import { pageFor } from "./nav-items";

/**
 * The bar above every app page: where you are (the menu group, then the page)
 * on the left; what's new and your account on the right.
 */
export function AppTopbar({
  email,
  isAdmin,
  changelogVersion,
  unread,
  signOut,
}: {
  email: string;
  isAdmin: boolean;
  changelogVersion: string;
  /** The account hasn't seen this changelog yet. */
  unread: boolean;
  signOut: () => Promise<void>;
}) {
  const pathname = usePathname();
  const page = pageFor(pathname, isAdmin);
  const Icon = page?.item.icon;

  return (
    <header className="app-topbar">
      <div className="topbar-crumb">
        {page && Icon ? (
          <>
            <span className="topbar-crumb-icon">
              <Icon size={15} />
            </span>
            {page.group ? (
              <>
                <span className="topbar-crumb-group">{page.group.label}</span>
                <ChevronRightIcon size={13} className="topbar-crumb-sep" />
              </>
            ) : null}
            <span className="topbar-crumb-page">{page.item.label}</span>
          </>
        ) : null}
      </div>
      <div className="topbar-tools">
        <UpdatesBell version={changelogVersion} unreadOnAccount={unread} />
        <AvatarMenu email={email} signOut={signOut} />
      </div>
    </header>
  );
}

/** Open/closed state for a top bar popover: closes on an outside click, Escape, or navigating. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const [shownFor, setShownFor] = useState(pathname);
  if (shownFor !== pathname) {
    setShownFor(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return { open, setOpen, ref };
}

function seenInThisBrowser(version: string): boolean {
  try {
    return window.localStorage.getItem(changelogStorageKey(version)) === "1";
  } catch {
    return false;
  }
}

/** The bell: the latest changelog, with a dot until it's been read here or in the popup. */
function UpdatesBell({ version, unreadOnAccount }: { version: string; unreadOnAccount: boolean }) {
  const { open, setOpen, ref } = usePopover();
  const seenHere = useSyncExternalStore(
    (notify) => {
      window.addEventListener(CHANGELOG_SEEN_EVENT, notify);
      window.addEventListener("storage", notify);
      return () => {
        window.removeEventListener(CHANGELOG_SEEN_EVENT, notify);
        window.removeEventListener("storage", notify);
      };
    },
    () => seenInThisBrowser(version),
    () => false,
  );
  const unread = unreadOnAccount && !seenHere;

  const toggle = () => {
    setOpen(!open);
    if (open || !unread) return;
    try {
      window.localStorage.setItem(changelogStorageKey(version), "1");
    } catch {
      // Nothing to remember it in: the account flag below still clears the dot.
    }
    window.dispatchEvent(new Event(CHANGELOG_SEEN_EVENT));
    void markChangelogSeen().catch(() => undefined);
  };

  const date = new Date(`${CHANGELOG.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  return (
    <div className="topbar-pop-anchor" ref={ref}>
      <button type="button" className="topbar-icon" aria-label={unread ? "What's new (unread)" : "What's new"} aria-expanded={open} onClick={toggle}>
        <BellIcon size={17} />
        {unread ? <span className="topbar-dot" aria-hidden="true" /> : null}
      </button>
      {open ? (
        <div className="topbar-pop topbar-updates" role="dialog" aria-label="What's new">
          <div className="topbar-pop-head">
            <strong>What&apos;s new</strong>
            <span>{date}</span>
          </div>
          <ul>
            {CHANGELOG.items.map((item) => (
              <li key={item.title}>
                <strong>{item.title}</strong>
                <span>{item.body}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Your initial on a tile; it opens the account pages and sign out. */
function AvatarMenu({ email, signOut }: { email: string; signOut: () => Promise<void> }) {
  const { open, setOpen, ref } = usePopover();
  const pathname = usePathname();

  return (
    <div className="topbar-pop-anchor" ref={ref}>
      <button type="button" className="topbar-avatar" aria-label="Account" aria-expanded={open} onClick={() => setOpen(!open)}>
        {email.slice(0, 1).toUpperCase()}
      </button>
      {open ? (
        <div className="topbar-pop topbar-account" role="menu">
          <div className="topbar-pop-head topbar-account-head">
            <strong>{email.split("@")[0]}</strong>
            <span title={email}>{email}</span>
          </div>
          {ACCOUNT_LINKS.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} role="menuitem" className="topbar-pop-link" aria-current={pathname.startsWith(href) ? "page" : undefined}>
              <Icon size={15} />
              {label}
            </Link>
          ))}
          <form action={signOut}>
            <button type="submit" role="menuitem" className="topbar-pop-link topbar-signout">
              <LogOutIcon size={15} />
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
