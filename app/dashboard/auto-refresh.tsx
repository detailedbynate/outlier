"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-renders the page every so often while something is still loading on the
 * server (the creator's own channel, right after onboarding). Gives up after a
 * few minutes so a channel that never resolves doesn't poll forever.
 */
export function AutoRefresh({ everyMs = 20_000, times = 9 }: { everyMs?: number; times?: number }) {
  const router = useRouter();
  useEffect(() => {
    let count = 0;
    const timer = setInterval(() => {
      if (document.hidden) return;
      count += 1;
      router.refresh();
      if (count >= times) clearInterval(timer);
    }, everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs, times]);
  return null;
}
