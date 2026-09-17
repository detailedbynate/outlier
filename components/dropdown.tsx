"use client";

import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";

/** Matches the dropdown-close animation in globals.css. */
const CLOSE_MS = 140;

/**
 * Disclosure dropdown built on <details>, so it works without JavaScript; with JS
 * it also closes on outside click, Escape, and after choosing a link inside, and
 * plays a closing animation before it hides.
 */
export function Dropdown({
  label,
  children,
  align = "start",
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = (focusSummary = false) => {
    const el = ref.current;
    if (!el?.open || el.dataset.closing) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finish = () => {
      delete el.dataset.closing;
      el.open = false;
      if (focusSummary) el.querySelector("summary")?.focus();
    };
    if (reduceMotion) return finish();
    el.dataset.closing = "true";
    closeTimer.current = setTimeout(finish, CLOSE_MS);
  };

  useEffect(() => {
    const onEvent = (event: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") close(true);
        return;
      }
      if (!el.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", onEvent);
    document.addEventListener("keydown", onEvent);
    return () => {
      document.removeEventListener("pointerdown", onEvent);
      document.removeEventListener("keydown", onEvent);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  // Clicking the button again closes with the animation instead of snapping shut.
  const onSummaryClick = (event: MouseEvent<HTMLElement>) => {
    if (ref.current?.open) {
      event.preventDefault();
      close();
    }
  };

  return (
    <details
      ref={ref}
      className={`dropdown ${className ?? ""}`}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a[href]")) close();
      }}
    >
      <summary className="toolbar-button" onClick={onSummaryClick}>
        {label}
      </summary>
      <div className={`dropdown-panel dropdown-${align}`}>{children}</div>
    </details>
  );
}
