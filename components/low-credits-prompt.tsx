"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CoinsIcon } from "./icons";

/**
 * Pops up once when credits run low, and again if they run out. "Not now" is
 * remembered per month and level in this browser, so it doesn't nag.
 */
export function LowCreditsPrompt({ remaining, threshold, month }: { remaining: number; threshold: number; month: string }) {
  const pathname = usePathname();
  const level = remaining <= 0 ? "empty" : remaining <= threshold ? "low" : null;
  const key = `outlier:low-credits:${month}:${level}`;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!level || pathname.startsWith("/billing")) return;
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(key) === "1";
    } catch {
      // Storage blocked: show it; dismissing just won't be remembered.
    }
    // Reading storage has to wait until mount, so this can't be initial state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!dismissed) setOpen(true);
  }, [key, level, pathname]);

  if (!open || !level) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      // Nothing to remember it in.
    }
    setOpen(false);
  };

  return (
    <div className="low-credits-backdrop" role="presentation" onClick={dismiss}>
      <div className="low-credits glass" role="dialog" aria-modal="true" aria-labelledby="low-credits-title" onClick={(e) => e.stopPropagation()}>
        <span className="credits-icon">
          <CoinsIcon size={18} />
        </span>
        <h2 id="low-credits-title">{level === "empty" ? "You're out of credits" : "You're running low on credits"}</h2>
        <p>
          {level === "empty"
            ? "Searches and research that use credits are paused until you refill or your monthly credits reset."
            : `You have ${remaining} credits left. Want to refill so you don't get cut off mid-research?`}
        </p>
        <div className="low-credits-actions">
          <button type="button" className="button-ghost" onClick={dismiss}>
            Not now
          </button>
          <Link href="/billing" className="low-credits-cta" onClick={dismiss}>
            Refill credits
          </Link>
        </div>
      </div>
    </div>
  );
}
