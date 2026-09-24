"use client";

import { useActionState, useRef, useState, type CSSProperties } from "react";
import { ScriptForm } from "./script-form";
import { findIdeas } from "./actions";
import { emptyIdeaState } from "./state";

/**
 * The ideas panel and the writer, together.
 *
 * They share one piece of state: the idea you picked. "Write this" fills the
 * form below rather than opening anything, because the whole point is that
 * finding an idea and writing it are the same sitting.
 */
export function Writer({ cost, ideaCost, limitNote }: { cost: number; ideaCost: number; limitNote: string | null }) {
  const [seed, setSeed] = useState<{ topic: string; idea: string } | null>(null);
  // Bumped on every pick so the form remounts and picks up the new defaults.
  const [seedKey, setSeedKey] = useState(0);
  const formRef = useRef<HTMLDivElement>(null);

  const use = (topic: string, idea: string) => {
    setSeed({ topic, idea });
    setSeedKey((key) => key + 1);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <IdeaFinder cost={ideaCost} onUse={use} />
      <div ref={formRef}>
        <ScriptForm key={seedKey} cost={cost} limitNote={limitNote} seed={seed} />
      </div>
    </>
  );
}

function IdeaFinder({ cost, onUse }: { cost: number; onUse: (topic: string, idea: string) => void }) {
  const [state, submit, pending] = useActionState(findIdeas, emptyIdeaState);

  return (
    <section className="sw-ideas">
      <div className="sw-ideas-head">
        <div>
          <h2 className="sw-saved-head">Find ideas</h2>
          <p className="dash-row-sub">
            Type a niche and it suggests Shorts to make. It can see everything you&apos;ve already written, so it won&apos;t
            suggest the same thing twice.
          </p>
        </div>
      </div>

      <form action={submit} className="sw-ideas-form">
        <input name="topic" defaultValue={state.topic} placeholder="minecraft redstone" maxLength={80} required autoComplete="off" />
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Thinking…" : "Find ideas"}
        </button>
        <small>{cost} credits</small>
      </form>

      {state.error ? <div className="dash-empty sw-error">{state.error}</div> : null}

      {pending ? (
        <ul className="sw-idea-list" aria-live="polite">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <li key={i} className="sw-idea sw-idea-ghost" style={{ "--i": i } as CSSProperties} />
          ))}
        </ul>
      ) : null}

      {state.ideas.length > 0 && !pending ? (
        <ul className="sw-idea-list">
          {state.ideas.map((idea, i) => (
            <li key={idea.title} className="sw-idea" style={{ "--i": i } as CSSProperties}>
              <h3>{idea.title}</h3>
              <p className="sw-idea-hook">&ldquo;{idea.hook}&rdquo;</p>
              <p className="sw-idea-why">{idea.why}</p>
              <button type="button" className="sw-idea-use" onClick={() => onUse(state.topic, idea.title)}>
                Write this →
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
