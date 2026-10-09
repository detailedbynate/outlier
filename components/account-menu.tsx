"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CoinsIcon, GiftIcon, LogOutIcon, MoreIcon, SlidersIcon } from "./icons";

const LINKS = [
  { href: "/billing", label: "Plans & credits", icon: CoinsIcon },
  { href: "/settings/preferences", label: "Preferences", icon: SlidersIcon },
  { href: "/referrals", label: "Refer friends", icon: GiftIcon },
];

/** The account row at the bottom of the sidebar; the dots open account pages and sign out. */
export function AccountMenu({ email, signOut }: { email: string; signOut: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const [shownFor, setShownFor] = useState(pathname);
  // Navigating closes it.
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

  return (
    <div className="sidebar-account" ref={ref}>
      <span className="account-avatar" aria-hidden="true">
        {email.slice(0, 1).toUpperCase()}
      </span>
      <span className="account-text">
        <span className="account-name">{email.split("@")[0]}</span>
        <span className="account-email" title={email}>
          {email}
        </span>
      </span>
      <button type="button" className="icon-button account-more" aria-label="Account menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <MoreIcon size={16} />
      </button>
      {open ? (
        <div className="account-menu" role="menu">
          {LINKS.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} role="menuitem" aria-current={pathname.startsWith(href) ? "page" : undefined}>
              <Icon size={15} />
              {label}
            </Link>
          ))}
          <form action={signOut}>
            <button type="submit" role="menuitem" className="account-menu-signout">
              <LogOutIcon size={15} />
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
