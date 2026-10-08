"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** Counts page views and who scrolls to pricing. No cookies; see lib/analytics/site.ts. */
export function SiteTracker({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const base = {
      path: pathname,
      signedIn,
      utmSource: params.get("utm_source"),
      utmMedium: params.get("utm_medium"),
      utmCampaign: params.get("utm_campaign"),
      code: params.get("code"),
      ref: params.get("ref"),
    };
    send({ ...base, kind: "pageview", referrer: document.referrer || null });

    const pricing = document.getElementById("pricing");
    if (!pricing || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      send({ ...base, kind: "pricing_view", referrer: null });
    }, { threshold: 0.25 });
    observer.observe(pricing);
    return () => observer.disconnect();
  }, [pathname, signedIn]);

  return null;
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
