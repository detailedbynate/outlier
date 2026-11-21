"use client";

import { useEffect, useRef } from "react";

/** "12.4K", "3.1×", "8%", "1,204": the number and what's around it. */
const NUMBER = /^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/;

const DURATION_MS = 1100;
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/**
 * Shows an already formatted number counting up from zero the first time it
 * scrolls into view, keeping its decimals, thousands separators and suffix,
 * and ending on exactly `value`. Text that isn't a number just appears.
 * Hidden until it starts (app/motion.css), so it never flashes the final
 * value first; without JavaScript it's plain text.
 */
export function CountUp({ value, className }: { value: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const match = NUMBER.exec(value);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!match || reduce) {
      el.textContent = value;
      el.dataset.counted = "";
      return;
    }
    const [, prefix, digits, suffix] = match as unknown as [string, string, string, string];
    const target = Number(digits.replace(/,/g, ""));
    const decimals = digits.includes(".") ? digits.split(".")[1]!.length : 0;
    const grouped = digits.includes(",");
    const format = (n: number) =>
      `${prefix}${grouped ? n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : n.toFixed(decimals)}${suffix}`;

    let frame = 0;
    const run = () => {
      const started = performance.now();
      el.dataset.counted = "";
      const tick = (now: number) => {
        const t = Math.min(1, (now - started) / DURATION_MS);
        el.textContent = t >= 1 ? value : format(target * easeOutExpo(t));
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      el.textContent = format(0);
      frame = requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          run();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      el.textContent = value;
      el.dataset.counted = "";
    };
  }, [value]);

  return (
    <span ref={ref} className={className ? `count-up ${className}` : "count-up"}>
      {value}
    </span>
  );
}
