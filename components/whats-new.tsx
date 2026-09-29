"use client";

import { useEffect, useState } from "react";
import { markChangelogSeen } from "@/app/changelog-actions";
import { CHANGELOG } from "@/lib/changelog";
import { ZapIcon } from "./icons";

/**
 * Shows the current changelog once. The account remembers it (see
 * markChangelogSeen); this browser remembers it too, so a slow or failed save
 * doesn't bring it back on the next page.
 */
export function WhatsNew() {
  const key = `outlier:changelog:${CHANGELOG.id}`;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = window.localStorage.getItem(key) === "1";
    } catch {
      // Storage blocked: the account flag still stops it after this time.
    }
    // Reading storage has to wait until mount, so this can't be initial state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!seen) setOpen(true);
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
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      // Nothing to remember it in.
    }
    setOpen(false);
    void markChangelogSeen().catch(() => undefined);
  }

  return (
    <div className="low-credits-backdrop" role="presentation" onClick={close}>
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
