"use client";

import { useState, type CSSProperties } from "react";
import type { StyleSampleRow } from "@/types/database";
import { addStyleSample, deleteStyleSample } from "./actions";

/**
 * The scripts the writer copies the voice of.
 *
 * Two is the threshold: below that it falls back to the built-in examples,
 * because one script is as likely to be someone's off day as their style. The
 * panel says which of the two is happening, so the writing never silently
 * changes character without an explanation.
 */
const MIN_SAMPLES = 2;

export function StyleSamples({ samples }: { samples: StyleSampleRow[] }) {
  const [adding, setAdding] = useState(false);
  const active = samples.length >= MIN_SAMPLES;

  return (
    <section className="sw-styles">
      <h2 className="sw-saved-head">
        Your writing style
        <span className="sw-style-state" data-on={active ? "" : undefined}>
          {active ? `learning from ${Math.min(samples.length, 3)}` : "using built-in examples"}
        </span>
      </h2>
      <p className="dash-row-sub">
        {active
          ? "Every script is written in the voice of these. Add more and the three most recent are used."
          : `Paste in Shorts scripts you've written. At ${MIN_SAMPLES} or more, the writer copies your voice instead of its built-in examples.`}
      </p>

      {samples.length > 0 ? (
        <ul className="sw-style-list">
          {samples.map((row, i) => (
            <StyleSample key={row.id} row={row} index={i} used={i < 3} />
          ))}
        </ul>
      ) : null}

      {adding ? (
        <form action={addStyleSample} className="sw-style-form">
          <label className="sw-field">
            <span>
              Label <em>optional</em>
            </span>
            <input name="label" placeholder="the one about hidden bases" maxLength={120} autoComplete="off" />
          </label>
          <label className="sw-field">
            <span>The script, as you said it</span>
            <textarea
              name="body"
              rows={7}
              required
              minLength={40}
              maxLength={6000}
              placeholder={"Paste the spoken words of one of your Shorts.\n\nJust what gets said out loud — no shot notes, no timestamps."}
            />
            <small>At least 40 characters. Long transcripts get trimmed to the first part.</small>
          </label>
          <div className="sw-style-actions">
            <button type="submit" className="btn btn-primary">
              Add script
            </button>
            <button type="button" className="sw-delete" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="sw-add" onClick={() => setAdding(true)}>
          + Add one of your scripts
        </button>
      )}
    </section>
  );
}

function StyleSample({ row, index, used }: { row: StyleSampleRow; index: number; used: boolean }) {
  const [open, setOpen] = useState(false);
  const preview = row.body.slice(0, 90).trim();

  return (
    <li className="sw-style-item" data-open={open ? "" : undefined} style={{ "--i": index } as CSSProperties}>
      <button type="button" className="sw-style-top" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="sw-style-name">{row.label?.trim() || preview}</span>
        {/* Only the three most recent reach the prompt; saying so beats a silent cut-off. */}
        <span className="sw-style-tag">{used ? "in use" : "not used"}</span>
      </button>
      {open ? (
        <div className="sw-style-body">
          <p className="sw-style-text">{row.body}</p>
          <form action={deleteStyleSample}>
            <input type="hidden" name="id" value={row.id} />
            <button type="submit" className="sw-delete">
              Remove
            </button>
          </form>
        </div>
      ) : null}
    </li>
  );
}
