"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ComponentType } from "react";
import type { SidebarPlan } from "./credits-meter";
import { ChartIcon, ChevronRightIcon, CompassIcon, FlameIcon, GridIcon, LockIcon, LogOutIcon, PlugIcon, ZapIcon } from "./icons";
import { ACCOUNT, ADMIN, MAIN, isActive, isGroup, type NavItem } from "./nav-items";
import { creditsLabel, navAccess, type SidebarCredits } from "./sidebar-nav";

/** The pages a phone reaches with one thumb; everything else is a tap on Menu away. */
const TABS: { href: string; label: string; icon: ComponentType<{ size?: number }> }[] = [
  { href: "/", label: "Home", icon: GridIcon },
  { href: "/research/niche-finder", label: "Niches", icon: CompassIcon },
  { href: "/viral", label: "Viral", icon: FlameIcon },
  { href: "/analyze", label: "Analyze", icon: ChartIcon },
];

const PLAN_NAME: Record<SidebarPlan, string> = { owner: "Owner", free: "Free plan", pro: "Pro plan", expert: "Expert plan" };

export interface MobileTabBarProps {
  email: string;
  plan?: SidebarPlan;
  isAdmin: boolean;
  writerOpen: boolean;
  freePlan: boolean;
  credits: SidebarCredits;
  signOut: () => Promise<void>;
}

/**
 * Phone-only bar along the bottom of every app page, and the Menu it opens: a
 * full screen of every page, grouped the way the sidebar groups them, with the
 * tab bar still underneath so Menu closes it again. Hidden on desktop.
 */
export function MobileTabBar(props: MobileTabBarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [openFor, setOpenFor] = useState(pathname);
  // Going to another page closes the menu.
  if (openFor !== pathname) {
    setOpenFor(pathname);
    setOpen(false);
  }

  // The page underneath stays put while the menu is open; Escape closes it.
  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.add("menu-open");
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.classList.remove("menu-open");
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onTab = TABS.some((tab) => isActive(pathname, tab.href));

  return (
    <>
      <MobileMenu {...props} open={open} close={() => setOpen(false)} />
      <nav className="mobile-tabs" aria-label="Main" data-menu={open || undefined}>
        {TABS.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className="mobile-tab" aria-current={isActive(pathname, href) ? "page" : undefined} onClick={() => setOpen(false)}>
            <Icon size={21} />
            <span>{label}</span>
          </Link>
        ))}
        <button
          type="button"
          className="mobile-tab mobile-tab-menu"
          data-here={!onTab || undefined}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((o) => !o)}
        >
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path className="mm-line mm-top" d="M4 7h16" />
            <path className="mm-line mm-mid" d="M4 12h16" />
            <path className="mm-line mm-bot" d="M4 17h16" />
          </svg>
          <span>{open ? "Close" : "Menu"}</span>
        </button>
      </nav>
    </>
  );
}

function MobileMenu({ email, plan, isAdmin, writerOpen, freePlan, credits, signOut, open, close }: MobileTabBarProps & { open: boolean; close: () => void }) {
  const pathname = usePathname();
  const groups = (isAdmin ? [...MAIN, ADMIN] : MAIN).filter(isGroup);
  const credit = creditsLabel(credits);

  // A page you're already on still closes the menu when tapped.
  const tile = (item: NavItem) => {
    const { locked, badge } = navAccess(item, freePlan, writerOpen);
    const Icon = item.icon;
    return (
      <Link key={item.href} href={item.href} className="mm-tile" aria-current={isActive(pathname, item.href) ? "page" : undefined} onClick={close}>
        <span className="mm-tile-icon">
          <Icon size={18} />
        </span>
        <span className="mm-tile-label">{item.label}</span>
        {badge ? (
          <span className="mm-badge" data-locked={locked || undefined}>
            {locked ? <LockIcon size={9} /> : null}
            {badge}
          </span>
        ) : null}
      </Link>
    );
  };

  const row = (item: Pick<NavItem, "href" | "label" | "icon" | "badge">, value?: { text: string; level?: string }) => {
    const Icon = item.icon;
    return (
      <Link key={item.href} href={item.href} className="mm-row" aria-current={isActive(pathname, item.href) ? "page" : undefined} onClick={close}>
        <Icon size={18} />
        <span className="mm-row-label">{item.label}</span>
        {value ? (
          <span className="mm-row-value" data-level={value.level}>
            {value.text}
          </span>
        ) : item.badge ? (
          <span className="mm-badge">{item.badge}</span>
        ) : null}
        <ChevronRightIcon size={15} />
      </Link>
    );
  };

  return (
    <div id="mobile-menu" className="mm-sheet" role="dialog" aria-modal="true" aria-label="Menu" data-open={open || undefined} inert={!open}>
      <div className="mm-body">
        <Link href="/billing" className="mm-account" onClick={close}>
          <span className="mm-avatar" aria-hidden="true">
            {email.slice(0, 1).toUpperCase()}
          </span>
          <span className="mm-account-text">
            <strong>{email.split("@")[0]}</strong>
            <span>
              {plan ? PLAN_NAME[plan] : email} · {credit.text === "Unlimited" ? "Unlimited credits" : `${credit.text} credits`}
            </span>
          </span>
          <ChevronRightIcon size={16} />
        </Link>

        {groups.map((group) => (
          <section key={group.id} className="mm-section">
            <h2>{group.label}</h2>
            <div className="mm-grid">{group.items.map(tile)}</div>
          </section>
        ))}

        <section className="mm-section">
          <h2>Account</h2>
          <div className="mm-list">
            {freePlan ? row({ href: "/billing#plans", label: "Upgrade plan", icon: ZapIcon, badge: "Pro" }) : null}
            {ACCOUNT.map((item) => (item.href === "/billing" ? (freePlan ? null : row({ ...item, label: "Plans & credits" }, { text: credit.text, level: credit.level })) : row(item)))}
            {row({ href: "/settings/connect-ai", label: "Connect AI", icon: PlugIcon, badge: "New" })}
            <form action={signOut}>
              <button type="submit" className="mm-row mm-signout">
                <LogOutIcon size={18} />
                <span className="mm-row-label">Sign out</span>
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
