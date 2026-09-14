"use client";

import type { MouseEvent, ReactNode } from "react";

/** Space kept above a section when scrolling to it, so the floating header doesn't cover it. */
const HEADER_OFFSET = 96;

/** Smooth-scroll to `#id`, then focus the target's first field when it's a form (e.g. the waitlist). */
export function scrollToSection(id: string): void {
  const target = document.getElementById(id);
  if (!target) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const top = target.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET;
  window.scrollTo({ top: Math.max(top, 0), behavior: reduced ? "auto" : "smooth" });
  history.replaceState(null, "", `#${id}`);

  const field = target.querySelector<HTMLInputElement>('input[type="email"], input:not([type="hidden"])');
  if (field) {
    // Focus after the scroll settles so the browser doesn't jump.
    window.setTimeout(() => field.focus({ preventScroll: true }), reduced ? 0 : 550);
  }
}

export function ScrollLink({
  to,
  className,
  children,
  onNavigate,
  ariaCurrent,
}: {
  to: string;
  className?: string;
  children: ReactNode;
  onNavigate?: () => void;
  ariaCurrent?: boolean;
}) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // Let people open in a new tab with modifier keys.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    scrollToSection(to);
    onNavigate?.();
  };
  return (
    <a href={`#${to}`} className={className} onClick={onClick} aria-current={ariaCurrent ? "location" : undefined}>
      {children}
    </a>
  );
}
