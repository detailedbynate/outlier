"use client";

import { useActionState, useState, type CSSProperties } from "react";
import { PenIcon } from "@/components/icons";
import { DURATIONS, TONES, WORDS_PER_SECOND, scriptLines, type ScriptResult } from "@/lib/scripts/schema";
import { writeScript } from "./actions";
import { emptyScriptState } from "./state";

const TONE_LABEL: Record<(typeof TONES)[number], string> = {
  energetic: "Energetic",
  calm: "Calm",
  funny: "Funny",
  serious: "Serious",
  story: "Story",
};

const SHORTEST = DURATIONS[0];
const LONGEST = DURATIONS[DURATIONS.length - 1]!;
const STEP = DURATIONS.length > 1 ? DURATIONS[1]! - DURATIONS[0] : 5;

/** The writer: what they want, then what it wrote. */
export function ScriptForm({ cost }: { cost: number }) {
  const [state, submit, pending] = useActionState(writeScript, emptyScriptState);
  // Held in React so the readout and the filled part of the track can follow it.
  const [seconds, setSeconds] = useState<number>(state.sent.seconds);
  const [tone, setTone] = useState<string>(state.sent.tone);
  const filled = (seconds - SHORTEST) / (LONGEST - SHORTEST);

  return (
    <>
      <form action={submit} className="sw-form">
        <div className="sw-row">
          <label className="sw-field">
            <span>Niche</span>
            <input name="topic" defaultValue={state.sent.topic} placeholder="minecraft" maxLength={80} required autoComplete="off" />
            <small>Who it&apos;s for. The script is written for people already in this niche.</small>
          </label>
          <label className="sw-field">
            <span>Video idea or title</span>
            <input name="idea" defaultValue={state.sent.idea} placeholder="why your redstone door keeps breaking" maxLength={200} required autoComplete="off" />
            <small>What this Short is about. A working title is enough.</small>
          </label>
        </div>

        <label className="sw-field">
          <span>
            Your angle <em>optional, but it&apos;s what stops it being generic</em>
          </span>
          <textarea name="angle" defaultValue={state.sent.angle} placeholder="I've played on the same survival world for 4 years" maxLength={300} rows={2} />
          <small>Anything true and specific you know. It gets built in rather than guessed at.</small>
        </label>

        <div className="sw-controls">
          <div className="sw-field sw-slider-field">
            <span>
              Length <output className="sw-seconds">{seconds}s</output>
            </span>
            <input
              className="sw-slider"
              type="range"
              name="seconds"
              min={SHORTEST}
              max={LONGEST}
              step={STEP}
              value={seconds}
              onChange={(event) => setSeconds(Number(event.target.value))}
              style={{ "--filled": filled } as CSSProperties}
              aria-label="Script length in seconds"
            />
            <div className="sw-ticks">
              {DURATIONS.map((value) => (
                <button key={value} type="button" className="sw-tick" data-on={value === seconds ? "" : undefined} onClick={() => setSeconds(value)}>
                  {value}s
                </button>
              ))}
            </div>
            <small>About {Math.round(seconds * WORDS_PER_SECOND)} spoken words.</small>
          </div>

          <div className="sw-field">
            <span>Tone</span>
            <input type="hidden" name="tone" value={tone} />
            <div className="sw-tones">
              {TONES.map((name) => (
                <button key={name} type="button" className="sw-tone" data-on={tone === name ? "" : undefined} onClick={() => setTone(name)}>
                  {TONE_LABEL[name]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="sw-submit">
          <button type="submit" className="btn btn-primary sw-write" disabled={pending}>
            <PenIcon size={15} /> {pending ? "Writing…" : "Write the script"}
          </button>
          <small>{cost} credits · one script every 3 hours</small>
        </div>
      </form>

      {state.error ? <div className="dash-empty sw-error">{state.error}</div> : null}
      {pending ? <PendingScript /> : null}
      {state.result && !pending ? <ScriptView result={state.result} charged={state.charged} /> : null}
    </>
  );
}

/** Something to watch while the model writes, shaped like the answer it will replace. */
function PendingScript() {
  return (
    <div className="sw-result" aria-live="polite">
      <section className="sw-script sw-pending">
        <header className="sw-script-head">
          <span className="dash-eyebrow">Writing…</span>
        </header>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="sw-ghost" style={{ "--i": i } as CSSProperties} />
        ))}
      </section>
    </div>
  );
}

export function Copyable({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="sw-copy"
      data-copied={copied ? "" : undefined}
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
  const lines = scriptLines(result.script.script);
  const seconds = Math.round(result.words / WORDS_PER_SECOND);

  return (
    <div className="sw-result">
      <section className="sw-script">
        <header className="sw-script-head">
          <span className="dash-eyebrow">Your script</span>
          <Copyable text={lines.join("\n")} label="Copy script" />
        </header>
        {lines.map((line, i) => (
          <p key={i} className={i === 0 ? "sw-line sw-line-hook" : "sw-line"} style={{ "--i": i } as CSSProperties}>
            {line}
          </p>
        ))}
      </section>

      <section className="sw-panel sw-titles-panel">
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
        {result.words} spoken words · about {seconds}s out loud · {charged} credits · {result.model}
        {result.id ? " · saved below" : ""}
      </p>
    </div>
  );
}
