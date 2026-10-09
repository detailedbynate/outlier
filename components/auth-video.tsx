"use client";

import { useEffect, useRef } from "react";

/** The home page's product video, silent and looping, in the sign-in screen's stage. Stays on its cover frame with reduced motion. */
export function AuthVideo() {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Hidden on phones (the stage is display: none there), so it plays only while it's actually on screen.
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) void video.play().catch(() => undefined);
      else video.pause();
    });
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return <video ref={ref} src="/videos/outlier-launch.mp4" poster="/videos/outlier-launch-poster.jpg" muted loop playsInline preload="metadata" />;
}
