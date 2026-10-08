"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

// Below this, a page wasn't really read; it's not worth a ping (Plausible uses the same idea).
const MIN_ENGAGED_MS = 3_000;

/**
 * Counts page views, who scrolls to pricing, and how long each page was on
 * screen and how far down it was read. First-party only; see lib/analytics/site.ts.
 */
export function SiteTracker({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();

  useEffect(() => {
    if (document.cookie.split("; ").includes("outlier_notrack=1")) return;
    const params = new URLSearchParams(window.location.search);
    const base = {
      path: pathname,
      signedIn,
      utmSource: params.get("utm_source"),
      source: params.get("source"),
      utmMedium: params.get("utm_medium"),
      utmCampaign: params.get("utm_campaign"),
      code: params.get("code"),
      ref: params.get("ref"),
    };
    send({ ...base, kind: "pageview", referrer: document.referrer || null });

    // Time on screen: counted only while the tab is visible, sent when it's hidden or left.
    let visibleSince: number | null = document.visibilityState === "visible" ? performance.now() : null;
    let engaged = 0;
    let sentEngaged = 0;
    let scroll = scrollPercent();
    let sentScroll = 0;
    const flush = () => {
      if (visibleSince !== null) {
        engaged += performance.now() - visibleSince;
        visibleSince = null;
      }
      const delta = engaged - sentEngaged;
      if (delta < MIN_ENGAGED_MS && scroll <= sentScroll) return;
      send({ ...base, kind: "engagement", engagedMs: Math.round(delta), scroll });
      sentEngaged = engaged;
      sentScroll = scroll;
    };
    const onScroll = () => {
      scroll = Math.max(scroll, scrollPercent());
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
      else visibleSince = performance.now();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);

    const pricing = document.getElementById("pricing");
    let observer: IntersectionObserver | null = null;
    if (pricing && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer?.disconnect();
        send({ ...base, kind: "pricing_view", referrer: null });
      }, { threshold: 0.25 });
      observer.observe(pricing);
    }

    return () => {
      flush();
      observer?.disconnect();
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [pathname, signedIn]);

  return null;
}

function scrollPercent(): number {
  const height = document.documentElement.scrollHeight;
  if (height <= 0) return 0;
  return Math.min(100, Math.round(((window.scrollY + window.innerHeight) / height) * 100));
}

function send(event: Record<string, unknown>) {
  try {
    const body = JSON.stringify(event);
    if (navigator.sendBeacon?.("/api/track", new Blob([body], { type: "application/json" }))) return;
    void fetch("/api/track", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {});
  } catch {
    // Counting is never worth breaking a page over.
  }
}
