"use client";

import { useDeferredValue, useState, type CSSProperties } from "react";
import Link from "next/link";
import { MicIcon } from "@/components/icons";
import { scriptText, WORDS_PER_SECOND } from "@/lib/scripts/schema";
import type { SavedScriptRow } from "@/types/database";
import { deleteSavedScript } from "./actions";
import { Copyable } from "./script-form";

/** Past this many, a filter box earns its place. */
const FILTER_FROM = 6;

/**
 * Every script written, newest first.
 *
 * Collapsed to its hook, because the hook is how you recognise one: opening
 * lines are distinct in a way "Minecraft, 30s" never is. Expanding is local
 * state rather than a link, so reading an old script never costs a page load.
 */
export function SavedScripts({ scripts }: { scripts: SavedScriptRow[] }) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query.trim().toLowerCase());

  if (scripts.length === 0) {
    return (
      <section className="sw-saved">
        <h2 className="sw-saved-head">Your scripts</h2>
        <div className="sw-saved-empty">
          <p>Every script you write is kept here, with its titles, ready to copy or voice.</p>
        </div>
      </section>
    );
  }

  const shown = deferred
    ? scripts.filter((row) => `${row.topic} ${row.idea} ${row.script} ${row.titles.join(" ")}`.toLowerCase().includes(deferred))
    : scripts;

  return (
    <section className="sw-saved">
      <div className="sw-saved-bar">
        <h2 className="sw-saved-head">
          Your scripts <span className="sw-count">{scripts.length}</span>
        </h2>
        {scripts.length >= FILTER_FROM ? (
          <input
            type="search"
            className="sw-saved-filter"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by niche, idea or words"
            aria-label="Filter your scripts"
          />
        ) : null}
      </div>
      {shown.length > 0 ? (
        <ul className="sw-saved-list">
          {shown.map((row, i) => (
            <SavedScript key={row.id} row={row} index={i} />
          ))}
        </ul>
      ) : (
        <p className="dash-row-sub sw-saved-none">No script mentions &ldquo;{query.trim()}&rdquo;.</p>
      )}
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
          <span className="sw-saved-topic">{row.topic}</span> · {row.seconds}s · {row.tone} ·{" "}
          {new Date(row.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </span>
        <span className="sw-chevron" aria-hidden="true">
          ›
        </span>
      </button>

      {/* Always rendered so it can unfold smoothly; inert while folded so its buttons aren't tabbable. */}
      <div className="sw-saved-fold" inert={!open}>
        <div className="sw-saved-body">
          <p className="sw-line">{text}</p>
          {row.titles.length > 0 ? (
            <ul className="sw-titles">
              {row.titles.map((title) => (
                <li key={title}>
                  <span>{title}</span> <Copyable text={title} label="Copy" />
                </li>
              ))}
            </ul>
          ) : null}
          <div className="sw-saved-actions">
            <Copyable text={text} label="Copy script" />
            <Link href={`/voice?script=${row.id}`} className="sw-copy sw-voice-link">
              <MicIcon size={12} /> Voice it
            </Link>
            <form action={deleteSavedScript}>
              <input type="hidden" name="id" value={row.id} />
              <button type="submit" className="sw-delete">
                Delete
              </button>
            </form>
            <span className="sw-footnote">
              {row.words} words · about {seconds}s
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}
