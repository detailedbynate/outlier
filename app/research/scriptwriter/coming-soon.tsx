"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { LockIcon } from "@/components/icons";

/**
 * Shows what the tool will be, without letting anyone use it yet.
 *
 * The preview behind stays on the page and stays readable — blurred, not hidden —
 * because the point is to make people want it. Nothing here is access control:
 * the real gate is in the server action, which refuses anyone but the owner.
 */
export function ComingSoonLock({ children }: { children: ReactNode }) {
  // Open on arrival: clicking the locked nav item is the click that asks for it,
  // so the answer shouldn't need a second one. Dismissing leaves the blurred
  // preview and the badge, and the badge opens it again.
  const [open, setOpen] = useState(true);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="sw-lock">
      {/* Inert: a preview, not a form. Nothing inside can be typed in or tabbed to. */}
      <div className="sw-lock-preview" aria-hidden="true" inert>
        {children}
      </div>

      <button type="button" className="sw-lock-hit" onClick={() => setOpen(true)}>
        <span className="sw-lock-badge">
          <LockIcon size={14} /> Coming soon
        </span>
        <span className="sr-only">The Shorts script writer isn&apos;t open yet. See what&apos;s coming.</span>
      </button>

      {open ? (
        <div className="sw-modal-scrim" onClick={() => setOpen(false)}>
          <div
            className="sw-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sw-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="sw-modal-icon">
              <LockIcon size={20} />
            </span>
            <h2 id="sw-modal-title">Coming soon</h2>
            <p>
              The Shorts script writer is still being built. It reads the outliers in your niche — the videos that beat their own
              channel — and writes a scripted Short from what they do, beat by beat.
            </p>
            <p className="sw-modal-note">It&apos;ll turn up on your plan when it&apos;s good enough to be worth your credits.</p>
            <button type="button" className="btn btn-primary" onClick={() => setOpen(false)} ref={closeRef}>
              Got it
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
