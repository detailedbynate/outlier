"use client";

import { useEffect, useRef } from "react";

/**
 * The product video under the hero: silent, looping, playing only while it's on
 * screen so it costs nothing once scrolled past. With reduced motion it stays
 * on its cover frame and gets controls instead.
 */
export function LaunchVideo() {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      video.controls = true;
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void video.play().catch(() => undefined);
        else video.pause();
      },
      { threshold: 0.25 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="launch-video" aria-label="Outlier in action">
      <div className="launch-video-frame">
        <video ref={ref} src="/videos/outlier-launch.mp4" poster="/videos/outlier-launch-poster.jpg" muted loop playsInline preload="metadata" />
      </div>
    </section>
  );
}
