"use client";

import { useActionState, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { MicIcon, PenIcon } from "@/components/icons";
import { DURATIONS, TONES, WORDS_PER_SECOND, scriptText, type ScriptResult } from "@/lib/scripts/schema";
import { soundsRecent } from "@/lib/scripts/prompt";
import { writeScript } from "./actions";
import { emptyScriptState } from "./state";

const TONE_LABEL: Record<(typeof TONES)[number], string> = {
  energetic: "Energetic",
  calm: "Calm",
  funny: "Funny",
  serious: "Serious",
  story: "Story",
};

/** What each tone sounds like, said under the pills so picking one isn't a guess. */
const TONE_NOTE: Record<(typeof TONES)[number], string> = {
  energetic: "Fast and punchy, short sentences.",
  calm: "Even and clear, like explaining to a friend.",
  funny: "Jokes on the way, the facts still land.",
  serious: "Straight, no jokes, weight on the facts.",
  story: "Told as something that happened.",
};

/** The four parts every script has, in order. Shown before, during and after writing. */
export const BEATS = [
  { name: "Hook", note: "One short line that stops the scroll." },
  { name: "Turn", note: "Why it's strange, so they don't swipe." },
  { name: "Body", note: "The actual method or story." },
  { name: "Payoff", note: "The thing they stayed for." },
] as const;

const SHORTEST = DURATIONS[0];
const LONGEST = DURATIONS[DURATIONS.length - 1]!;
/** The allowed length nearest a point on the track. */
const snap = (value: number): number => DURATIONS.reduce<number>((best, d) => (Math.abs(d - value) < Math.abs(best - value) ? d : best), DURATIONS[0]);

/** Splits spoken text into sentences at end punctuation followed by a space, so "3.5" stays whole. */
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?…]["'”’)\]]*)\s+(?=\S)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** "0:07". */
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/**
 * The writer: what you want on the left, the script on the right.
 *
 * The right side is never blank. Before anything's written it shows the shape
 * every script takes and how many words the chosen length allows; while it
 * writes it walks through those parts; then it's the script, sentence by
 * sentence, with a practice read that paces you through it.
 */
export function ScriptForm({
  cost,
  limitNote,
  seed,
  seeded = false,
}: {
  cost: number;
  /** "4 scripts a day", or null when there's no limit. */
  limitNote: string | null;
  /** An idea picked from the finder above, which wins over whatever was last submitted. */
  seed?: { topic: string; idea: string } | null;
  /** True when this mount came from picking an idea, so the form can show it took it. */
  seeded?: boolean;
}) {
  const [state, submit, pending] = useActionState(writeScript, emptyScriptState);
  // Held in React so the readout and the filled part of the track can follow it.
  // The thumb glides with the pointer; the length snaps to 15/20/25/30 when it's let go.
  const [position, setPosition] = useState<number>(state.sent.seconds);
  const seconds = snap(position);
  const settle = () => setPosition(seconds);
  const [tone, setTone] = useState<(typeof TONES)[number]>(state.sent.tone);
  // Watched only to ask for details when the idea is about something newer than the model.
  const [idea, setIdea] = useState<string>(seed?.idea || state.sent.idea);
  const askForDetails = soundsRecent(idea);
  const filled = (position - SHORTEST) / (LONGEST - SHORTEST);
  const words = Math.round(seconds * WORDS_PER_SECOND);

  return (
    <div className="sw-work">
      <form action={submit} className="sw-form sw-composer" data-seeded={seeded ? "" : undefined}>
        <header className="sw-sec-head">
          <span className="sw-step">2</span>
          <div>
            <h2 className="sw-saved-head">Shape it</h2>
            <p className="dash-row-sub">What it&apos;s about, how long, and how it sounds.</p>
          </div>
        </header>

        <div className="sw-row">
          <label className="sw-field">
            <span>Niche</span>
            <input name="topic" defaultValue={seed?.topic || state.sent.topic} placeholder="minecraft" maxLength={80} required autoComplete="off" />
            <small>Who it&apos;s for. It writes for people already in this niche.</small>
          </label>
          <label className="sw-field">
            <span>Video idea or title</span>
            <textarea
              name="idea"
              className="sw-idea-input"
              defaultValue={seed?.idea || state.sent.idea}
              placeholder="why your redstone door keeps breaking"
              maxLength={1500}
              rows={2}
              required
              autoComplete="off"
              onChange={(e) => setIdea(e.target.value)}
            />
            {askForDetails ? (
              <small className="sw-ask" role="status">
                Sounds new. The writer doesn&apos;t know what&apos;s in recent updates, so add what changed here or it&apos;ll keep it general.
              </small>
            ) : (
              <small>A working title is enough. Add your angle, real numbers or what happened to you and it writes around that.</small>
            )}
          </label>
        </div>

        <div className="sw-controls">
          <div className="sw-field sw-slider-field">
            <span>
              Length <output className="sw-seconds">{seconds}s</output>
            </span>
            <input
              className="sw-slider"
              type="range"
              min={SHORTEST}
              max={LONGEST}
              step={0.1}
              value={position}
              onChange={(event) => setPosition(Number(event.target.value))}
              onPointerUp={settle}
              onKeyUp={settle}
              onBlur={settle}
              style={{ "--filled": filled } as CSSProperties}
              aria-label="Script length in seconds"
              aria-valuetext={`${seconds} seconds`}
            />
            <input type="hidden" name="seconds" value={seconds} />
            <div className="sw-ticks">
              {DURATIONS.map((value) => (
                <button key={value} type="button" className="sw-tick" data-on={value === seconds ? "" : undefined} onClick={() => setPosition(value)}>
                  {value}s
                </button>
              ))}
            </div>
            <small>About {words} spoken words.</small>
          </div>

          <div className="sw-field">
            <span>Tone</span>
            <input type="hidden" name="tone" value={tone} />
            <div className="sw-tones" role="radiogroup" aria-label="Tone">
              {TONES.map((name) => (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={tone === name}
                  className="sw-tone"
                  data-on={tone === name ? "" : undefined}
                  onClick={() => setTone(name)}
                >
                  {TONE_LABEL[name]}
                </button>
              ))}
            </div>
            <small key={tone} className="sw-tone-note">
              {TONE_NOTE[tone]}
            </small>
          </div>
        </div>

        <div className="sw-submit">
          <button type="submit" className="btn btn-primary sw-write" disabled={pending}>
            <PenIcon size={15} /> {pending ? "Writing…" : state.result ? "Write another take" : "Write the script"}
          </button>
          <small>
            {cost} credits{limitNote ? ` · ${limitNote}` : ""}
          </small>
        </div>
      </form>

      <section className="sw-stage" aria-live="polite" aria-busy={pending}>
        {state.error && !pending ? <div className="dash-empty sw-error">{state.error}</div> : null}
        {pending ? (
          <PendingScript />
        ) : state.result ? (
          <ScriptView key={state.result.id ?? state.result.script.script} result={state.result} charged={state.charged} target={state.sent.seconds} />
        ) : (
          <EmptyStage seconds={seconds} words={words} />
        )}
      </section>
    </div>
  );
}

/** Before anything's written: the shape it will take, at the length chosen. */
function EmptyStage({ seconds, words }: { seconds: number; words: number }) {
  return (
    <div className="sw-stage-empty">
      <header className="sw-stage-head">
        <span className="sw-step">3</span>
        <div>
          <h2 className="sw-saved-head">Your script</h2>
          <p className="dash-row-sub">
            Lands here, ready to read out. At {seconds}s that&apos;s about {words} words in four parts:
          </p>
        </div>
      </header>
      <ol className="sw-beats">
        {BEATS.map((beat, i) => (
          <li key={beat.name} className="sw-beat" style={{ "--b": i } as CSSProperties}>
            <span className="sw-beat-name">{beat.name}</span>
            <span className="sw-beat-note">{beat.note}</span>
            <span className="sw-beat-lines" aria-hidden="true">
              <i />
              {i > 0 ? <i /> : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** While the model writes: the same four parts, lit one after another. */
function PendingScript() {
  return (
    <div className="sw-stage-empty sw-pending">
      <header className="sw-stage-head">
        <span className="sw-step sw-step-busy" aria-hidden="true" />
        <div>
          <h2 className="sw-saved-head">Writing your script…</h2>
          <p className="dash-row-sub">Usually 5 to 15 seconds.</p>
        </div>
      </header>
      <ol className="sw-beats">
        {BEATS.map((beat, i) => (
          <li key={beat.name} className="sw-beat" style={{ "--b": i } as CSSProperties}>
            <span className="sw-beat-name">{beat.name}</span>
            <span className="sw-beat-note">{beat.note}</span>
            <span className="sw-beat-lines" aria-hidden="true">
              <i />
              <i />
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Copyable({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);
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

/**
 * The script, how well it fits the length, and the titles to put on it.
 *
 * "Practice read" paces you through it at speaking speed: the sentence you
 * should be on is bright, what you've said dims, and the bar shows where a
 * {target}s Short would end. Reading along once tells you more about whether
 * it fits than any word count.
 */
function ScriptView({ result, charged, target }: { result: ScriptResult; charged: number; target: number }) {
  const text = scriptText(result.script.script);
  const sentences = useMemo(() => sentencesOf(text), [text]);
  // When each sentence starts, at speaking pace.
  const counts = useMemo(() => sentences.map(wordCount), [sentences]);
  const starts = useMemo(() => counts.map((_, i) => counts.slice(0, i).reduce((sum, n) => sum + n, 0) / WORDS_PER_SECOND), [counts]);
  const total = useMemo(() => counts.reduce((sum, n) => sum + n, 0) / WORDS_PER_SECOND, [counts]);
  const spoken = result.words / WORDS_PER_SECOND;
  const fit = spoken > target * 1.1 ? "long" : spoken < target * 0.8 ? "short" : "fits";

  const [elapsed, setElapsed] = useState<number | null>(null);
  const frame = useRef(0);
  const playing = elapsed !== null;

  const stop = () => {
    cancelAnimationFrame(frame.current);
    setElapsed(null);
  };

  const start = () => {
    cancelAnimationFrame(frame.current);
    const began = performance.now();
    const tick = (now: number) => {
      const t = (now - began) / 1000;
      if (t >= total) {
        setElapsed(null);
        return;
      }
      setElapsed(t);
      frame.current = requestAnimationFrame(tick);
    };
    setElapsed(0);
    frame.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // Which sentence the reader should be on.
  const now = elapsed !== null ? starts.findLastIndex((at) => at <= elapsed) : -1;
  const [hook, ...rest] = sentences;

  return (
    <div className="sw-result">
      <article className="sw-script sw-read" data-playing={playing ? "" : undefined}>
        <header className="sw-script-head">
          <span className="dash-eyebrow">
            <span className="sw-step">3</span> Your script
          </span>
          <span className="sw-head-actions">
            <button type="button" className="sw-copy sw-practice" data-on={playing ? "" : undefined} onClick={playing ? stop : start}>
              {playing ? "Stop" : "Practice read"}
            </button>
            {result.id ? (
              <Link href={`/voice?script=${result.id}`} className="sw-copy sw-voice-link">
                <MicIcon size={12} /> Voice it
              </Link>
            ) : null}
            <Copyable text={text} label="Copy script" />
          </span>
        </header>

        <div className="sw-fit" data-fit={fit}>
          <div className="sw-fit-track" aria-hidden="true">
            <span className="sw-fit-fill" style={{ "--fit": Math.min(spoken / target, 1) } as CSSProperties} />
            {elapsed !== null ? <span className="sw-fit-play" style={{ "--fit": Math.min(elapsed / target, 1) } as CSSProperties} /> : null}
          </div>
          <span className="sw-fit-text">
            {elapsed !== null ? (
              <>
                <strong>{clock(elapsed)}</strong> of about {clock(spoken)}
              </>
            ) : (
              <>
                {result.words} words · about {Math.round(spoken)}s out loud ·{" "}
                <strong>{fit === "fits" ? `fits ${target}s` : fit === "long" ? `runs long for ${target}s` : `runs short for ${target}s`}</strong>
              </>
            )}
          </span>
        </div>

        <div className="sw-lines">
          {hook ? (
            <p className="sw-hook-line">
              <span className="sw-sentence" data-at={now === 0 ? "now" : now > 0 ? "said" : undefined} style={{ "--n": 0 } as CSSProperties}>
                {hook}
              </span>
            </p>
          ) : null}
          {rest.length > 0 ? (
            <p className="sw-line">
              {rest.map((sentence, i) => {
                const index = i + 1;
                return (
                  <span
                    key={index}
                    className="sw-sentence"
                    data-at={now === index ? "now" : now > index ? "said" : undefined}
                    style={{ "--n": index } as CSSProperties}
                  >
                    {sentence}{" "}
                  </span>
                );
              })}
            </p>
          ) : null}
        </div>
      </article>

      <section className="sw-panel sw-titles-panel">
        <h3>Titles</h3>
        <ul className="sw-titles">
          {result.script.titles.map((title, i) => (
            <li key={title} style={{ "--n": i } as CSSProperties}>
              <span>{title}</span> <Copyable text={title} label="Copy" />
            </li>
          ))}
        </ul>
      </section>

      <p className="sw-footnote">
        {charged} credits · {result.model}
        {result.id ? " · saved to Your scripts below" : ""}
      </p>
    </div>
  );
}
