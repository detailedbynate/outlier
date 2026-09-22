"use client";

import { useActionState, useState } from "react";
import { PenIcon } from "@/components/icons";
import { DURATIONS, TONES, WORDS_PER_SECOND, type ScriptResult } from "@/lib/scripts/schema";
import { writeScript } from "./actions";
import { emptyScriptState } from "./state";

const TONE_LABEL: Record<(typeof TONES)[number], string> = {
  energetic: "Energetic",
  calm: "Calm",
  funny: "Funny",
  serious: "Serious",
  story: "Story",
};

/** The writer: what they want, then what it wrote. */
export function ScriptForm({ cost }: { cost: number }) {
  const [state, submit, pending] = useActionState(writeScript, emptyScriptState);

  return (
    <>
      <form action={submit} className="sw-form">
        <div className="sw-row">
          <label className="sw-field">
            <span>Niche</span>
            <input name="topic" defaultValue={state.sent.topic} placeholder="minecraft" maxLength={80} required autoComplete="off" />
            <small>The niche to study. Its outliers are what the script learns from.</small>
          </label>
          <label className="sw-field">
            <span>Video idea or title</span>
            <input name="idea" defaultValue={state.sent.idea} placeholder="the redstone trick nobody uses" maxLength={200} required autoComplete="off" />
            <small>What this Short is about. A working title is enough.</small>
          </label>
        </div>

        <label className="sw-field">
          <span>
            Your angle <em>optional</em>
          </span>
          <textarea name="angle" defaultValue={state.sent.angle} placeholder="I've played on the same survival world for 4 years" maxLength={300} rows={2} />
          <small>What you have that nobody else does. This is what stops a script coming out generic.</small>
        </label>

        <div className="sw-row">
          <label className="sw-field">
            <span>Length</span>
            <select name="seconds" defaultValue={state.sent.seconds}>
              {DURATIONS.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds} seconds
                </option>
              ))}
            </select>
          </label>
          <label className="sw-field">
            <span>Tone</span>
            <select name="tone" defaultValue={state.sent.tone}>
              {TONES.map((name) => (
                <option key={name} value={name}>
                  {TONE_LABEL[name]}
                </option>
              ))}
            </select>
          </label>
          <div className="sw-submit">
            <button type="submit" className="btn btn-primary" disabled={pending}>
              <PenIcon size={15} /> {pending ? "Writing…" : "Write the script"}
            </button>
            <small>{cost} credits</small>
          </div>
        </div>
      </form>

      {state.error ? <div className="dash-empty">{state.error}</div> : null}
      {pending ? <p className="sw-waiting">Reading the niche&apos;s outliers, then writing. This takes a few seconds.</p> : null}
      {state.result && !pending ? <ScriptView result={state.result} charged={state.charged} /> : null}
    </>
  );
}

function Copyable({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="sw-copy"
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => setCopied(true))
          // A browser that refuses the clipboard shouldn't look like a broken button.
          .catch(() => setCopied(false));
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

/** The script, and the titles to put on it. Nothing else — it's made to be read out. */
function ScriptView({ result, charged }: { result: ScriptResult; charged: number }) {
  const lines = result.script.script.split("\n").map((line) => line.trim()).filter(Boolean);
  const seconds = Math.round(result.words / WORDS_PER_SECOND);

  return (
    <div className="sw-result">
      <section className="sw-script">
        <header className="sw-script-head">
          <span className="dash-eyebrow">Your script</span>
          <Copyable text={lines.join("\n")} label="Copy script" />
        </header>
        {lines.map((line, i) => (
          <p key={i} className={i === 0 ? "sw-line sw-line-hook" : "sw-line"}>
            {line}
          </p>
        ))}
      </section>

      <section className="sw-panel">
        <h3>Titles</h3>
        <ul className="sw-titles">
          {result.script.titles.map((title) => (
            <li key={title}>
              {title} <Copyable text={title} label="Copy" />
            </li>
          ))}
        </ul>
      </section>

      <p className="sw-footnote">
        {result.words} spoken words · about {seconds}s out loud · {charged} credits · written by {result.model}
      </p>
    </div>
  );
}
