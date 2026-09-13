"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Disclosure dropdown built on <details>, so it works without JavaScript; with JS
 * it also closes on outside click, Escape, and after choosing a link inside.
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

  useEffect(() => {
    const close = (event: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") {
          el.open = false;
          el.querySelector("summary")?.focus();
        }
        return;
      }
      if (!el.contains(event.target as Node)) el.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  return (
    <details
      ref={ref}
      className={`dropdown ${className ?? ""}`}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a[href]") && ref.current) ref.current.open = false;
      }}
    >
      <summary className="toolbar-button">{label}</summary>
      <div className={`dropdown-panel dropdown-${align}`}>{children}</div>
    </details>
  );
}
