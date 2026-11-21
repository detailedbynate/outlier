"use client";

import { useActionState, useRef, useState, type CSSProperties } from "react";
import { ScriptForm } from "./script-form";
import { findIdeas } from "./actions";
import { emptyIdeaState } from "./state";

/**
 * The ideas panel and the writer, together.
 *
 * They share one piece of state: the idea you picked. "Use this idea" fills the
 * form below rather than opening anything, because the whole point is that
 * finding an idea and writing it are the same sitting.
 */
export function Writer({ cost, ideaCost, limitNote, initialSeed = null }: { cost: number; ideaCost: number; limitNote: string | null; initialSeed?: { topic: string; idea: string } | null }) {
  const [seed, setSeed] = useState<{ topic: string; idea: string } | null>(initialSeed);
  // Bumped on every pick so the form remounts and picks up the new defaults.
  const [seedKey, setSeedKey] = useState(0);
  const formRef = useRef<HTMLDivElement>(null);

  const use = (topic: string, idea: string) => {
    setSeed({ topic, idea });
    setSeedKey((key) => key + 1);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    formRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  return (
    <>
      <IdeaFinder cost={ideaCost} onUse={use} picked={seed?.idea ?? null} />
      <div ref={formRef} className="sw-work-anchor">
        <ScriptForm key={seedKey} cost={cost} limitNote={limitNote} seed={seed} seeded={seedKey > 0} />
      </div>
    </>
  );
}

function IdeaFinder({ cost, onUse, picked }: { cost: number; onUse: (topic: string, idea: string) => void; picked: string | null }) {
  const [state, submit, pending] = useActionState(findIdeas, emptyIdeaState);

  return (
    <section className="sw-ideas">
      <div className="sw-ideas-top">
        <header className="sw-sec-head">
          <span className="sw-step">1</span>
          <div>
            <h2 className="sw-saved-head">
              Find an idea <em className="sw-optional">optional</em>
            </h2>
            <p className="dash-row-sub">Type your niche for 6 Shorts ideas. Pick one and it fills in the form. It skips anything you&apos;ve already written.</p>
          </div>
        </header>

        <form action={submit} className="sw-ideas-form">
          <input name="topic" defaultValue={state.topic} placeholder="Your niche, e.g. minecraft redstone" maxLength={80} required autoComplete="off" aria-label="Your niche" />
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "Thinking…" : state.ideas.length > 0 ? "Get 6 more" : "Get ideas"}
          </button>
          <small>{cost} credits</small>
        </form>
      </div>

      {state.error ? <div className="dash-empty sw-error">{state.error}</div> : null}

      {pending ? (
        <ul className="sw-idea-list" aria-live="polite" aria-label="Finding ideas">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <li key={i} className="sw-idea sw-idea-ghost" style={{ "--i": i } as CSSProperties}>
              <i />
              <i />
              <i />
            </li>
          ))}
        </ul>
      ) : null}

      {state.ideas.length > 0 && !pending ? (
        <ul className="sw-idea-list">
          {state.ideas.map((idea, i) => {
            const chosen = picked === idea.title;
            return (
              <li key={idea.title} className="sw-idea" data-picked={chosen ? "" : undefined} style={{ "--i": i } as CSSProperties}>
                <span className="sw-idea-num">Idea {i + 1}</span>
                <h3>{idea.title}</h3>
                <dl className="sw-idea-parts">
                  <div>
                    <dt>First line of the video</dt>
                    <dd className="sw-idea-hook">&ldquo;{idea.hook}&rdquo;</dd>
                  </div>
                  <div>
                    <dt>Why people would watch</dt>
                    <dd className="sw-idea-why">{idea.why}</dd>
                  </div>
                </dl>
                <button type="button" className="sw-idea-use" onClick={() => onUse(state.topic, idea.title)}>
                  {chosen ? (
                    "In the form ✓"
                  ) : (
                    <>
                      Use this idea <span aria-hidden="true">↓</span>
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
