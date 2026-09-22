"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { LockIcon } from "@/components/icons";

/**
 * Shows what the tool will be, without letting anyone use it yet.
 *
 * The preview behind stays on the page and stays readable — blurred, not hidden —
 * because the point is to make people want it. Nothing here is access control:
 * the real gate is in the server action, which refuses anyone but the owner.
 *
 * Two reasons someone can be standing outside, and they want different answers:
 * on a paid plan the tool simply isn't open yet, and there's nothing to buy. On
 * Free it's a plan away, so the honest thing is to say which plan and link to it.
 */
export function ComingSoonLock({ children, mode = "soon" }: { children: ReactNode; mode?: "soon" | "upgrade" }) {
  const upgrade = mode === "upgrade";
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
          <LockIcon size={14} /> {upgrade ? "Pro feature" : "Coming soon"}
        </span>
        <span className="sr-only">
          {upgrade ? "The Shorts script writer is on Pro and above. See what it does." : "The Shorts script writer isn't open yet. See what's coming."}
        </span>
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
            <h2 id="sw-modal-title">{upgrade ? "Pro and above" : "Coming soon"}</h2>
            <p>
              The Shorts script writer takes your niche and an idea and writes the words — hook, turn, payoff — ready to read out
              loud, in your own voice once you&apos;ve shown it a couple of your scripts.
            </p>
            {upgrade ? (
              <>
                <p className="sw-modal-note">It&apos;s part of Pro. Your research tools stay exactly as they are on Free.</p>
                <Link href="/billing" className="btn btn-primary">
                  See Pro
                </Link>
                <button type="button" className="sw-modal-dismiss" onClick={() => setOpen(false)} ref={closeRef}>
                  Not now
                </button>
              </>
            ) : (
              <>
                <p className="sw-modal-note">It&apos;ll turn up on your plan when it&apos;s good enough to be worth your credits.</p>
                <button type="button" className="btn btn-primary" onClick={() => setOpen(false)} ref={closeRef}>
                  Got it
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
