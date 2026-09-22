"use client";

import { useState, type CSSProperties } from "react";
import { scriptText, WORDS_PER_SECOND } from "@/lib/scripts/schema";
import type { SavedScriptRow } from "@/types/database";
import { deleteSavedScript } from "./actions";
import { Copyable } from "./script-form";

/**
 * Every script written, newest first.
 *
 * Collapsed to its hook, because the hook is how you recognise one: opening
 * lines are distinct in a way "Minecraft, 30s" never is. Expanding is local
 * state rather than a link, so reading an old script never costs a page load.
 */
export function SavedScripts({ scripts }: { scripts: SavedScriptRow[] }) {
  if (scripts.length === 0) {
    return (
      <section className="sw-saved">
        <h2 className="sw-saved-head">Your scripts</h2>
        <p className="dash-row-sub">Scripts you write are kept here automatically.</p>
      </section>
    );
  }

  return (
    <section className="sw-saved">
      <h2 className="sw-saved-head">
        Your scripts <span className="sw-count">{scripts.length}</span>
      </h2>
      <ul className="sw-saved-list">
        {scripts.map((row, i) => (
          <SavedScript key={row.id} row={row} index={i} />
        ))}
      </ul>
    </section>
  );
}

function SavedScript({ row, index }: { row: SavedScriptRow; index: number }) {
  const [open, setOpen] = useState(false);
  const text = scriptText(row.script);
  // The opening sentence is how you recognise a script in a list.
  const hook = /^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? row.idea;
  const seconds = Math.round(row.words / WORDS_PER_SECOND);

  return (
    <li className="sw-saved-item" data-open={open ? "" : undefined} style={{ "--i": index } as CSSProperties}>
      <button type="button" className="sw-saved-top" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="sw-saved-hook">{hook}</span>
        <span className="sw-saved-meta">
          {row.topic} · {row.seconds}s · {new Date(row.created_at).toLocaleDateString()}
        </span>
        <span className="sw-chevron" aria-hidden="true">
          ›
        </span>
      </button>

      {open ? (
        <div className="sw-saved-body">
          <p className="sw-line">{text}</p>
          {row.titles.length > 0 ? (
            <ul className="sw-titles">
              {row.titles.map((title) => (
                <li key={title}>
                  {title} <Copyable text={title} label="Copy" />
                </li>
              ))}
            </ul>
          ) : null}
          <div className="sw-saved-actions">
            <Copyable text={text} label="Copy script" />
            <form action={deleteSavedScript}>
              <input type="hidden" name="id" value={row.id} />
              <button type="submit" className="sw-delete">
                Delete
              </button>
            </form>
            <span className="sw-footnote">
              {row.words} words · about {seconds}s · {row.tone}
            </span>
          </div>
        </div>
      ) : null}
    </li>
  );
}
