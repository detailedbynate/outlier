"use client";

import { useActionState, useState } from "react";
import { PenIcon, ExternalIcon, FlameIcon } from "@/components/icons";
import { formatCompact } from "@/lib/format";
import { DURATIONS, TONES, type ScriptResult } from "@/lib/scripts/schema";
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

/** The whole script as plain text, for pasting into a notes app or a teleprompter. */
function asPlainText(result: ScriptResult): string {
  const lines = [`HOOK: ${result.script.hook}`, ""];
  result.script.beats.forEach((beat, i) => {
    lines.push(`${i + 1}. (${beat.seconds}s) ${beat.say}`);
    if (beat.onScreen) lines.push(`   on screen: ${beat.onScreen}`);
    lines.push(`   visual: ${beat.visual}`);
  });
  lines.push("", `ENDING: ${result.script.ending}`, "", `TITLES: ${result.script.titles.join(" / ")}`);
  if (result.script.caption) lines.push("", `CAPTION: ${result.script.caption}`);
  return lines.join("\n");
}

function ScriptView({ result, charged }: { result: ScriptResult; charged: number }) {
  const { script } = result;
  const withOpenings = result.sources.filter((source) => source.opening).length;

  return (
    <div className="sw-result">
      <div className="sw-hook">
        <div className="sw-hook-head">
          <span className="dash-eyebrow">The hook</span>
          <Copyable text={asPlainText(result)} label="Copy script" />
        </div>
        <p className="sw-hook-line">&ldquo;{script.hook}&rdquo;</p>
        <p className="sw-hook-why">{script.hookReason}</p>
      </div>

      <ol className="sw-beats">
        {script.beats.map((beat, i) => (
          <li key={i}>
            <span className="sw-beat-time">{beat.seconds}s</span>
            <div className="sw-beat-body">
              <p className="sw-beat-say">{beat.say}</p>
              {beat.onScreen ? (
                <p className="sw-beat-meta">
                  <strong>On screen</strong> {beat.onScreen}
                </p>
              ) : null}
              <p className="sw-beat-meta">
                <strong>Shot</strong> {beat.visual}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <div className="sw-panels">
        <section className="sw-panel">
          <h3>Ending</h3>
          <p>{script.ending}</p>
        </section>
        <section className="sw-panel">
          <h3>Titles</h3>
          <ul className="sw-titles">
            {script.titles.map((title) => (
              <li key={title}>
                {title} <Copyable text={title} label="Copy" />
              </li>
            ))}
          </ul>
        </section>
        {script.caption ? (
          <section className="sw-panel">
            <h3>Caption</h3>
            <p>{script.caption}</p>
            <Copyable text={script.caption} label="Copy caption" />
          </section>
        ) : null}
        <section className="sw-panel">
          <h3>Why this should work</h3>
          <p>{script.whyItWorks}</p>
        </section>
      </div>

      {result.sources.length > 0 ? (
        <section className="sw-sources">
          <h3>
            <FlameIcon size={14} /> Built from these outliers
          </h3>
          <p className="dash-row-sub">
            Real videos from this niche that beat their own channel
            {withOpenings > 0 ? `, ${withOpenings} with their opening words read` : ""}.
          </p>
          <ul className="dash-list">
            {result.sources.map((source) => (
              <li key={source.youtubeVideoId}>
                <a href={`https://www.youtube.com/shorts/${source.youtubeVideoId}`} target="_blank" rel="noreferrer">
                  <strong>{source.title}</strong>
                  <span className="dash-row-sub">
                    {source.channelTitle} · {formatCompact(source.views)} views · {source.multiplier}× its usual
                  </span>
                  {source.opening ? <span className="sw-source-opening">Opens: &ldquo;{source.opening}&rdquo;</span> : null}
                </a>
                <ExternalIcon size={13} />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="dash-row-sub">
          No outliers stored for that niche yet, so this was written from principles alone. Research it in the Niche Finder first for a sharper script.
        </p>
      )}

      <p className="sw-footnote">
        {result.seconds}s of speech across {script.beats.length} beats · {charged} credits · written by {result.model}
      </p>
    </div>
  );
}
