"use client";

import { useEffect, useState } from "react";
import { markChangelogSeen } from "@/app/changelog-actions";
import { CHANGELOG } from "@/lib/changelog";
import { ZapIcon } from "./icons";

/** How long after the page has loaded before it comes in, so it doesn't land on a half-drawn page. */
const SETTLE_MS = 900;
/** Matches the exit transition in globals.css. */
const EXIT_MS = 260;

/**
 * Shows the current changelog once. The account remembers it (see
 * markChangelogSeen); this browser remembers it too, so a slow or failed save
 * doesn't bring it back on the next page.
 */
export function WhatsNew({ version }: { version: string }) {
  const key = `outlier:changelog:${version}`;
  const [open, setOpen] = useState(false);
  // The entrance is a CSS animation that plays on mount; "out" runs the exit.
  const [phase, setPhase] = useState<"in" | "out">("in");

  useEffect(() => {
    let seen = false;
    try {
      seen = window.localStorage.getItem(key) === "1";
    } catch {
      // Storage blocked: the account flag still stops it after this time.
    }
    if (seen) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = () => {
      timer = setTimeout(() => setOpen(true), SETTLE_MS);
    };
    if (document.readyState === "complete") show();
    else window.addEventListener("load", show, { once: true });
    return () => {
      window.removeEventListener("load", show);
      clearTimeout(timer);
    };
  }, [key]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!open) return null;

  function close() {
    if (phase === "out") return;
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      // Nothing to remember it in.
    }
    setPhase("out");
    setTimeout(() => setOpen(false), EXIT_MS);
    void markChangelogSeen().catch(() => undefined);
  }

  return (
    <div className="whats-new-backdrop" data-phase={phase} role="presentation" onClick={close}>
      <div className="low-credits whats-new" role="dialog" aria-modal="true" aria-labelledby="whats-new-title" onClick={(e) => e.stopPropagation()}>
        <span className="whats-new-badge">
          <ZapIcon size={14} /> New
        </span>
        <h2 id="whats-new-title">{CHANGELOG.title}</h2>
        <ul className="whats-new-list">
          {CHANGELOG.items.map((item) => (
            <li key={item.title}>
              <strong>{item.title}</strong>
              <span>{item.body}</span>
            </li>
          ))}
        </ul>
        <div className="low-credits-actions">
          <button type="button" className="low-credits-cta whats-new-cta" onClick={close} autoFocus>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
