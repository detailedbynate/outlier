"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState, useTransition, type MouseEvent, type ReactNode } from "react";

/**
 * Tabs and filters on the Discover boards. A click lights the new tab and dims
 * the board straight away, so it's clear something is happening while the
 * server works out the next board; the old one stays put instead of blanking.
 */
const NavState = createContext<{ pending: boolean; target: string | null; go: (href: string) => void }>({ pending: false, target: null, go: () => {} });

export function BoardNav({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<string | null>(null);
  const go = (href: string) => {
    setTarget(href);
    startTransition(() => router.push(href, { scroll: false }));
  };
  return <NavState.Provider value={{ pending, target: pending ? target : null, go }}>{children}</NavState.Provider>;
}

/** A tab or filter chip; `group` lets it tell whether the pending click was a sibling. */
export function NavLink({ href, active, group, className, children, current }: { href: string; active: boolean; group: string[]; className?: string; children: ReactNode; current?: boolean }) {
  const { target, go } = useContext(NavState);
  // While a click in this group is loading, that one shows as chosen.
  const on = target && group.includes(target) ? target === href : active;
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    go(href);
  };
  return (
    <Link href={href} className={className} data-mine={on} aria-current={current && on ? "page" : undefined} onClick={onClick}>
      {children}
    </Link>
  );
}

export function BoardBody({ children }: { children: ReactNode }) {
  const { pending } = useContext(NavState);
  return (
    <div className="board-body" data-pending={pending} aria-busy={pending}>
      {children}
    </div>
  );
}
