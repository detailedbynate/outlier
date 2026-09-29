"use client";

import { createPortal } from "react-dom";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { dismissScriptTour } from "./actions";

interface Step {
  /** What to spotlight; none means a centered card. */
  target?: string;
  title: string;
  body: ReactNode;
}

/** A little room around the highlighted part so it doesn't feel cropped. */
const PAD = 10;
/** Wait for the page (and the What's new popup, if it's up) before starting. */
const START_AFTER_MS = 800;
/** Re-measure while a smooth scroll lands; how long it takes depends on the distance. */
const SCROLL_SETTLE_MS = [0, 250, 500, 800, 1200];

function steps(ideaCost: number, scriptCost: number): Step[] {
  return [
    {
      title: "Welcome to the Script Writer",
      body: (
        <p>
          It writes the words for a Short, ready to read out. Here&apos;s a quick tour of how it works. It takes about 30
          seconds.
        </p>
      ),
    },
    {
      target: ".sw-ideas",
      title: "Stuck for an idea? Start here",
      body: (
        <p>
          Type your niche and you get 6 ideas, each with a first line and why people would watch. &ldquo;Use this idea&rdquo;
          fills in the form for you, and it skips anything you&apos;ve already written. This part is optional. {ideaCost} credits.
        </p>
      ),
    },
    {
      target: ".sw-form .sw-row",
      title: "Say what it's about",
      body: (
        <p>
          <strong>Niche</strong> is who it&apos;s for. <strong>Video idea</strong> is what the Short is about. A title is
          enough, but add your angle, real numbers, or what happened to you and it writes around that. It won&apos;t make up
          facts, and it doesn&apos;t know about recent updates, so put those in yourself.
        </p>
      ),
    },
    {
      target: ".sw-controls",
      title: "Pick a length and a tone",
      body: (
        <p>
          15 to 30 seconds. The word count under the slider shows how much that is out loud. Tone changes how it sounds:
          energetic, calm, funny, serious, or told as a story.
        </p>
      ),
    },
    {
      target: ".sw-submit",
      title: "Write it",
      body: (
        <>
          <p>For {scriptCost} credits you get one block of spoken words plus a few titles. Every script has the same shape:</p>
          <ol className="sw-tour-beats">
            <li>
              <strong>Hook:</strong> one short, surprising line
            </li>
            <li>
              <strong>Turn:</strong> why it&apos;s strange, so they don&apos;t swipe
            </li>
            <li>
              <strong>Body:</strong> the actual method or story
            </li>
            <li>
              <strong>Payoff:</strong> the thing they stayed for
            </li>
            <li>
              <strong>Landing:</strong> a last line that loops back
            </li>
          </ol>
        </>
      ),
    },
    {
      target: ".sw-styles",
      title: "Make it sound like you",
      body: (
        <p>
          Paste in scripts from Shorts you&apos;ve already made, just the words you say out loud. Once you have{" "}
          <strong>2 or more</strong>, every script copies how you talk. It uses your 3 most recent. With fewer than 2 it uses
          built-in examples.
        </p>
      ),
    },
    {
      target: ".sw-saved",
      title: "Everything's saved here",
      body: <p>Every script you write lands here, so you can come back, copy it, or use it as a starting point.</p>,
    },
    {
      title: "You're ready",
      body: <p>Pick an idea or type your own, and treat what comes back as a strong first draft. Edit it until it sounds like you, then record.</p>,
    },
  ];
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * A guided walk through the page: it scrolls to each part, spotlights it, and
 * explains it. "Close" hides it for now; "Don't show again" remembers it on the
 * account. The page decides whether it runs at all (see SCRIPT_TOUR_UNTIL).
 */
export function ScriptTour({ ideaCost, scriptCost }: { ideaCost: number; scriptCost: number }) {
  const all = steps(ideaCost, scriptCost);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const step = all[index]!;
  const last = index === all.length - 1;

  // Start once the page has loaded, the tab is in front, and nothing else is covering it.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tryStart = () => {
      clearTimeout(timer);
      // A background tab would run the tour to nobody; wait until they look.
      if (document.hidden) return;
      timer = setTimeout(() => {
        if (document.hidden) return;
        if (document.querySelector(".whats-new-backdrop")) tryStart();
        else setOpen(true);
      }, START_AFTER_MS);
    };
    const onVisible = () => {
      if (!document.hidden && document.readyState === "complete") tryStart();
    };
    if (document.readyState === "complete") tryStart();
    else window.addEventListener("load", tryStart, { once: true });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("load", tryStart);
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(timer);
    };
  }, []);

  const target = step.target;

  // Scroll the part into view, then keep the spotlight on it while the page moves.
  useEffect(() => {
    if (!open) return;
    const el = target ? document.querySelector(target) : null;
    const measure = () => {
      if (!el) return setBox(null);
      const r = el.getBoundingClientRect();
      setBox({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
    };
    const timers = SCROLL_SETTLE_MS.map((ms) => setTimeout(measure, ms));
    if (el) {
      const r = el.getBoundingClientRect();
      // Tall parts start at the top; short ones sit in the middle with room for the card.
      const block = r.height > window.innerHeight * 0.55 ? "start" : "center";
      const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block });
      // If the smooth scroll never got going (some browsers skip it), jump there instead.
      timers.push(
        setTimeout(() => {
          const now = el.getBoundingClientRect();
          // Scrolled into place, its top sits in the upper half of the screen.
          if (now.top < -10 || now.top > window.innerHeight * 0.5) {
            el.scrollIntoView({ behavior: "auto", block });
            measure();
          }
        }, 700),
      );
    }
    // Capture catches scrolling in any container, not just the window (the app scrolls an inner element on phones).
    document.addEventListener("scroll", measure, { passive: true, capture: true });
    window.addEventListener("resize", measure);
    return () => {
      timers.forEach(clearTimeout);
      document.removeEventListener("scroll", measure, { capture: true });
      window.removeEventListener("resize", measure);
    };
  }, [open, target]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, all.length - 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, all.length]);

  if (!open) return null;

  const neverAgain = () => {
    setOpen(false);
    void dismissScriptTour().catch(() => undefined);
  };

  // The card goes below the spotlight if there's room, otherwise above it, otherwise over it.
  const cardStyle: CSSProperties = {};
  if (box) {
    const below = box.top + box.height + 14;
    const spaceBelow = window.innerHeight - below;
    if (spaceBelow > 230) {
      cardStyle.top = below;
      cardStyle.maxHeight = spaceBelow - 16;
    } else if (box.top > 250) {
      cardStyle.bottom = window.innerHeight - box.top + 14;
      cardStyle.maxHeight = box.top - 30;
    } else {
      cardStyle.bottom = 24;
    }
    cardStyle.left = Math.min(Math.max(box.left, 16), window.innerWidth - 16 - Math.min(400, window.innerWidth - 32));
  }

  // On <body>: the page animates in with a transform, which would shift anything fixed inside it.
  return createPortal(
    <div className="sw-tour" role="dialog" aria-modal="true" aria-labelledby="sw-tour-title">
      {box ? (
        <div className="sw-tour-spot" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} aria-hidden="true" />
      ) : (
        <div className="sw-tour-dim" aria-hidden="true" />
      )}

      <div className="sw-tour-card" data-centered={box ? undefined : ""} style={cardStyle} key={index}>
        <span className="sw-tour-count">
          {index + 1} of {all.length}
        </span>
        <h2 id="sw-tour-title">{step.title}</h2>
        <div className="sw-tour-body">{step.body}</div>

        <div className="sw-tour-dots" aria-hidden="true">
          {all.map((_, i) => (
            <span key={i} data-on={i === index ? "" : undefined} />
          ))}
        </div>

        <div className="sw-tour-actions">
          <button type="button" className="sw-tour-quiet" onClick={neverAgain}>
            Don&apos;t show again
          </button>
          <span className="sw-tour-nav">
            <button type="button" className="sw-tour-quiet" onClick={() => setOpen(false)}>
              Close
            </button>
            {index > 0 ? (
              <button type="button" className="button-ghost button-small" onClick={() => setIndex(index - 1)}>
                Back
              </button>
            ) : null}
            <button type="button" className="sw-tour-next" onClick={() => (last ? setOpen(false) : setIndex(index + 1))} autoFocus>
              {last ? "Start writing" : index === 0 ? "Show me" : "Next"}
            </button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
