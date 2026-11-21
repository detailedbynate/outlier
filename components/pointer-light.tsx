"use client";

import { useEffect } from "react";

/** Surfaces that catch the faint cursor light (styled in app/motion.css). */
const LIT = ".video-card, .channel-card, .dash-panel, .card, .niche-idea-card, .sw-idea";

/**
 * One listener for the whole app: marks the card under the pointer with
 * `data-lit` and keeps `--mx`/`--my` (the pointer inside it) current, once a
 * frame at most. Skipped on touch screens and with reduced motion.
 */
export function PointerLight() {
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let lit: HTMLElement | null = null;
    let frame = 0;
    let x = 0;
    let y = 0;

    const paint = () => {
      frame = 0;
      if (!lit) return;
      const box = lit.getBoundingClientRect();
      lit.style.setProperty("--mx", `${Math.round(x - box.left)}px`);
      lit.style.setProperty("--my", `${Math.round(y - box.top)}px`);
    };

    const onMove = (event: PointerEvent) => {
      x = event.clientX;
      y = event.clientY;
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(LIT) : null;
      if (target !== lit) {
        lit?.removeAttribute("data-lit");
        lit = target;
        lit?.setAttribute("data-lit", "");
      }
      if (lit && !frame) frame = requestAnimationFrame(paint);
    };

    const onLeave = () => {
      lit?.removeAttribute("data-lit");
      lit = null;
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      if (frame) cancelAnimationFrame(frame);
      lit?.removeAttribute("data-lit");
    };
  }, []);

  return null;
}
