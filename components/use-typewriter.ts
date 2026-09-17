"use client";

import { useEffect, useState } from "react";

const TYPE_MS = 42;
const DELETE_MS = 18;
const HOLD_MS = 1_900;
const GAP_MS = 380;

/**
 * Types each phrase out, holds it, deletes it, and moves to the next. For
 * animated input placeholders. Pauses while `active` is false, and shows the
 * first phrase without motion for people who prefer reduced motion.
 */
export function useTypewriter(phrases: readonly string[], active = true): string {
  const [text, setText] = useState(phrases[0] ?? "");

  useEffect(() => {
    if (!active || phrases.length === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let phrase = 0;
    let length = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      const current = phrases[phrase]!;
      if (!deleting) {
        length += 1;
        setText(current.slice(0, length));
        if (length >= current.length) {
          deleting = true;
          timer = setTimeout(tick, HOLD_MS);
          return;
        }
        timer = setTimeout(tick, TYPE_MS);
        return;
      }
      length -= 1;
      setText(current.slice(0, Math.max(length, 0)));
      if (length <= 0) {
        deleting = false;
        phrase = (phrase + 1) % phrases.length;
        timer = setTimeout(tick, GAP_MS);
        return;
      }
      timer = setTimeout(tick, DELETE_MS);
    };

    // Start from an empty field so the first phrase types in too.
    timer = setTimeout(() => {
      setText("");
      tick();
    }, GAP_MS);
    return () => clearTimeout(timer);
  }, [phrases, active]);

  return text;
}
