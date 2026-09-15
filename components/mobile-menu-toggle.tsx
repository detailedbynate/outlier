"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Phone-only menu button for the app sidebar. Toggles `data-open` on the
 * enclosing sidebar (CSS turns it into a full-screen menu). Hidden on desktop.
 */
export function MobileMenuToggle() {
  const ref = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  const setOpen = (open: boolean) => {
    const sidebar = ref.current?.closest<HTMLElement>(".sidebar");
    if (!sidebar || !ref.current) return;
    sidebar.toggleAttribute("data-open", open);
    ref.current.setAttribute("aria-expanded", String(open));
    document.documentElement.classList.toggle("menu-open", open);
  };

  // Close after navigating.
  useEffect(() => {
    const sidebar = ref.current?.closest<HTMLElement>(".sidebar");
    sidebar?.removeAttribute("data-open");
    ref.current?.setAttribute("aria-expanded", "false");
    document.documentElement.classList.remove("menu-open");
  }, [pathname]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <button
      ref={ref}
      type="button"
      className="mobile-menu-toggle icon-button"
      aria-label="Menu"
      aria-expanded="false"
      aria-controls="app-sidebar-menu"
      onClick={() => setOpen(!ref.current?.closest(".sidebar")?.hasAttribute("data-open"))}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path className="mm-line mm-top" d="M4 7h16" />
        <path className="mm-line mm-mid" d="M4 12h16" />
        <path className="mm-line mm-bot" d="M4 17h16" />
      </svg>
    </button>
  );
}