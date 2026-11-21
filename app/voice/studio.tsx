"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties, type ReactNode, type RefObject } from "react";
import { CheckIcon, ChevronDownIcon, DownloadIcon, PauseIcon, PenIcon, PlayIcon, SearchIcon } from "@/components/icons";
import { DEFAULT_VOICE_SETTINGS, type Voice, type VoiceSettings } from "@/lib/voice/elevenlabs";
import { generateVoice } from "./actions";
import { Player, fileNameFor, type Clip } from "./wave-player";
import { orbStyle } from "./orb";

export interface ScriptOption {
  id: string;
  label: string;
  text: string;
}

/** Characters read per second at normal speed: about 2.8 words of ~5.7 characters. */
const CHARS_PER_SECOND = 16;

/** Something to hear straight away, shaped like what people make Shorts with. */
const STARTERS = [
  { label: "A hook that stops the scroll", text: "You've been doing this wrong the whole time, and it's been costing you hours every single week. Here's the fix." },
  { label: "Tell a short story", text: "Three years ago I found a box in my grandfather's attic that nobody in my family could explain. Inside was a single key, and a note that said: not yet." },
  { label: "Count down a list", text: "Three things in this game nobody tells you about. Number three completely changed the way I play." },
  { label: "Hype an announcement", text: "It's finally here. After months of waiting, the update everyone's been asking for just dropped, and it's even bigger than the leaks." },
] as const;

const chips = (v: Voice) => [v.accent, v.gender, v.tone].filter((x): x is string => Boolean(x));

/** Closes a popover when the pointer goes down outside it or Escape is pressed. */
function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open, close]);
}

/**
 * The studio: write or paste on the left, pick a voice and how it reads on the
 * right, hear it in the bar along the bottom. Laid out like ElevenLabs' text to
 * speech on purpose: it's what people who've used one expect.
 */
export function Studio({
  voices,
  scripts,
  initialText,
  maxCharacters,
  allowance,
  used: initialUsed,
  resetsOn,
  model,
}: {
  voices: Voice[];
  scripts: ScriptOption[];
  initialText: string;
  maxCharacters: number;
  /** Characters a month on this plan, or null for no limit. */
  allowance: number | null;
  used: number;
  /** When the allowance resets, e.g. "Nov 1". */
  resetsOn: string;
  model: { name: string; note: string };
}) {
  const [text, setText] = useState(initialText);
  const [voiceId, setVoiceId] = useState(voices[0]?.id ?? "");
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const [tab, setTab] = useState<"settings" | "history">("settings");
  const [clips, setClips] = useState<Clip[]>([]);
  const [current, setCurrent] = useState<Clip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [used, setUsed] = useState(initialUsed);
  const [pending, start] = useTransition();
  const nextId = useRef(1);
  const editor = useRef<HTMLTextAreaElement>(null);
  const voice = voices.find((v) => v.id === voiceId) ?? voices[0];

  const length = text.replace(/\s+/g, " ").trim().length;
  const left = allowance === null ? null : Math.max(0, allowance - used);
  const over = length > maxCharacters;
  // Past what's left this month: the button stays off and the meter says why.
  const overAllowance = left !== null && length > left;
  const seconds = Math.max(1, Math.round(length / CHARS_PER_SECOND / settings.speed));
  const settingsChanged = settings.speed !== DEFAULT_VOICE_SETTINGS.speed || settings.stability !== DEFAULT_VOICE_SETTINGS.stability || settings.style !== DEFAULT_VOICE_SETTINGS.style;

  // Blob URLs hold audio in memory until they're let go.
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const fill = (value: string) => {
    setText(value);
    // Back in the editor with the caret at the end, ready to change a word or generate.
    requestAnimationFrame(() => {
      const el = editor.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(value.length, value.length);
    });
  };

  const generate = () => {
    if (!voice || !length || over || overAllowance || pending) return;
    start(async () => {
      setError(null);
      const result = await generateVoice({ text, voiceId: voice.id, ...settings });
      if (result.used !== null) setUsed(result.used);
      if (!result.audio) {
        setError(result.error);
        return;
      }
      const bytes = Uint8Array.from(atob(result.audio), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
      urls.current.push(url);
      const clip: Clip = { id: nextId.current++, url, bytes: bytes.buffer as ArrayBuffer, voice, text: text.trim(), at: new Date() };
      setClips((all) => [clip, ...all]);
      setCurrent(clip);
    });
  };

  return (
    <div className="vx" data-busy={pending ? "" : undefined}>
      <section className="vx-editor">
        <div className="vx-toolbar">
          {scripts.length > 0 ? <ScriptMenu scripts={scripts} onPick={fill} /> : <span />}
          {text ? (
            <button type="button" className="vx-ghost" onClick={() => fill("")}>
              Clear
            </button>
          ) : null}
        </div>

        <div className="vx-canvas">
          <textarea
            ref={editor}
            className="vx-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate();
            }}
            placeholder="Start typing here, or paste your script, and pick a voice on the right."
            spellCheck
            aria-label="Text to read out"
            readOnly={pending}
          />

          {!text ? (
            <div className="vx-starters">
              <span className="vx-starters-label">Get started with</span>
              <div className="vx-starter-list">
                {scripts.slice(0, 2).map((s, i) => (
                  <button key={s.id} type="button" className="vx-starter vx-starter-mine" onClick={() => fill(s.text)} style={{ "--i": i } as CSSProperties}>
                    <PenIcon size={13} /> {s.label}
                  </button>
                ))}
                {STARTERS.map((s, i) => (
                  <button key={s.label} type="button" className="vx-starter" onClick={() => fill(s.text)} style={{ "--i": i + Math.min(2, scripts.length) } as CSSProperties}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <footer className="vx-foot">
          <span className="vx-count" data-over={over ? "" : undefined}>
            <span className="vx-count-num">{length.toLocaleString("en-US")}</span> / {maxCharacters.toLocaleString("en-US")}
            {length > 0 ? <em> · about {seconds}s</em> : null}
          </span>
          <div className="vx-generate">
            {allowance !== null && left !== null ? <AllowanceMeter left={left} allowance={allowance} resetsOn={resetsOn} short={overAllowance} /> : null}
            <button type="button" className="btn btn-primary vx-go" onClick={generate} disabled={!voice || !length || over || overAllowance || pending}>
              {pending ? <span className="vx-shimmer">Generating…</span> : "Generate speech"}
            </button>
          </div>
        </footer>
        {error ? <div className="dash-empty sw-error vx-error">{error}</div> : null}
      </section>

      <aside className="vx-side">
        <div className="vx-tabs" role="tablist" data-tab={tab}>
          <button type="button" role="tab" aria-selected={tab === "settings"} onClick={() => setTab("settings")}>
            Settings
          </button>
          <button type="button" role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>
            History{clips.length ? <span className="vx-tab-count">{clips.length}</span> : null}
          </button>
          <span className="vx-tab-ink" aria-hidden="true" />
        </div>

        {tab === "settings" ? (
          <div className="vx-panel" key="settings">
            <Field label="Voice">{voice ? <VoicePicker voices={voices} selected={voice} onPick={setVoiceId} /> : null}</Field>

            <Field label="Model">
              <div className="vx-model">
                <strong>{model.name}</strong>
                <small>{model.note}</small>
              </div>
            </Field>

            <Slider label="Speed" value={settings.speed} shown={`${settings.speed.toFixed(2)}×`} left="Slower" right="Faster" min={0.7} max={1.2} step={0.05} onChange={(speed) => setSettings({ ...settings, speed })} />
            <Slider label="Stability" value={settings.stability} shown={`${Math.round(settings.stability * 100)}%`} left="More expressive" right="More stable" min={0} max={1} step={0.05} onChange={(stability) => setSettings({ ...settings, stability })} />
            <Slider label="Style" value={settings.style} shown={`${Math.round(settings.style * 100)}%`} left="None" right="Exaggerated" min={0} max={1} step={0.05} onChange={(style) => setSettings({ ...settings, style })} />

            <button type="button" className="vx-ghost vx-reset" onClick={() => setSettings(DEFAULT_VOICE_SETTINGS)} disabled={!settingsChanged}>
              Reset values
            </button>
          </div>
        ) : (
          <History clips={clips} current={current} onPick={setCurrent} />
        )}
      </aside>

      <Player clip={current} pending={pending} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="vx-field">
      <span className="vx-label">{label}</span>
      {children}
    </div>
  );
}

function Slider({
  label,
  value,
  shown,
  left,
  right,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  /** The value as people read it: "1.05×", "50%". */
  shown: string;
  left: string;
  right: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="vx-slider">
      <span className="vx-slider-head">
        <span className="vx-label">{label}</span>
        <output className="vx-value">{shown}</output>
      </span>
      <input
        className="sw-slider vx-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ "--filled": (value - min) / (max - min) } as CSSProperties}
      />
      <span className="vx-slider-ends">
        <small>{left}</small>
        <small>{right}</small>
      </span>
    </label>
  );
}

/** "Use one of my scripts": a menu of saved scripts by their opening line. */
function ScriptMenu({ scripts, onPick }: { scripts: ScriptOption[]; onPick: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(box, open, () => setOpen(false));

  return (
    <div className="vx-scripts" ref={box}>
      <button type="button" className="vx-pill" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu">
        <PenIcon size={13} /> My scripts <ChevronDownIcon size={13} />
      </button>
      {open ? (
        <ul className="vx-pop vx-script-list" role="menu">
          {scripts.map((s, i) => (
            <li key={s.id} role="none" style={{ "--i": i } as CSSProperties}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onPick(s.text);
                  setOpen(false);
                }}
              >
                <strong>{s.label}</strong>
                <small>{s.text.replace(/\s+/g, " ").trim().length.toLocaleString("en-US")} characters</small>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The chosen voice, and every voice in a popover: search, filter, hear a sample, pick. */
function VoicePicker({ voices, selected, onPick }: { voices: Voice[]; selected: Voice; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [gender, setGender] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const sample = useRef<HTMLAudioElement | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    sample.current?.pause();
    setPlaying(null);
  };
  useDismiss(box, open, close);
  useEffect(() => () => sample.current?.pause(), []);

  const genders = useMemo(() => [...new Set(voices.map((v) => v.gender).filter((g): g is string => Boolean(g)))].sort(), [voices]);
  const needle = query.trim().toLowerCase();
  const shown = voices.filter(
    (v) => (!gender || v.gender === gender) && (!needle || [v.name, v.accent, v.tone, v.useCase, v.age].some((x) => x?.toLowerCase().includes(needle))),
  );

  const preview = (v: Voice) => {
    sample.current?.pause();
    if (playing === v.id || !v.previewUrl) {
      setPlaying(null);
      return;
    }
    const el = new Audio(v.previewUrl);
    el.onended = () => setPlaying(null);
    sample.current = el;
    setPlaying(v.id);
    void el.play().catch(() => setPlaying(null));
  };

  return (
    <div className="vx-voice" ref={box}>
      <button type="button" className="vx-voice-current" onClick={() => (open ? close() : setOpen(true))} aria-expanded={open} aria-haspopup="listbox">
        <span className="vx-orb" style={orbStyle(selected.id)} aria-hidden="true" />
        <span className="vx-who-text">
          <strong>{selected.name}</strong>
          <small>{chips(selected).join(" · ")}</small>
        </span>
        <ChevronDownIcon size={16} />
      </button>

      {open ? (
        <div className="vx-pop vx-library">
          <div className="vx-search">
            <SearchIcon size={14} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${voices.length} voices`} aria-label="Search voices" autoFocus />
          </div>
          {genders.length > 1 ? (
            <div className="vx-filters">
              <button type="button" data-on={gender === null ? "" : undefined} onClick={() => setGender(null)}>
                All
              </button>
              {genders.map((g) => (
                <button key={g} type="button" data-on={gender === g ? "" : undefined} onClick={() => setGender(g)}>
                  {g}
                </button>
              ))}
            </div>
          ) : null}
          <ul className="vx-voice-list" role="listbox" aria-label="Voices">
            {shown.map((v) => (
              <li key={v.id} data-on={v.id === selected.id ? "" : undefined} data-playing={playing === v.id ? "" : undefined}>
                <button type="button" className="vx-sample" onClick={() => preview(v)} disabled={!v.previewUrl} aria-label={playing === v.id ? `Stop ${v.name}` : `Hear ${v.name}`} style={orbStyle(v.id)}>
                  {playing === v.id ? <PauseIcon size={11} /> : <PlayIcon size={11} />}
                </button>
                <button
                  type="button"
                  role="option"
                  aria-selected={v.id === selected.id}
                  className="vx-voice-pick"
                  onClick={() => {
                    onPick(v.id);
                    close();
                  }}
                >
                  <strong>{v.name}</strong>
                  <small>{[v.accent, v.age, v.tone ?? v.useCase].filter(Boolean).join(" · ")}</small>
                </button>
                {v.id === selected.id ? <CheckIcon size={14} className="vx-check" /> : null}
              </li>
            ))}
            {shown.length === 0 ? <li className="vx-none">No voices match.</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function History({ clips, current, onPick }: { clips: Clip[]; current: Clip | null; onPick: (clip: Clip) => void }) {
  if (clips.length === 0) {
    return (
      <div className="vx-panel" key="history">
        <p className="vx-none">What you generate shows up here. It&apos;s kept until you leave the page, so download anything you want to keep.</p>
      </div>
    );
  }
  return (
    <ul className="vx-panel vx-history" key="history">
      {clips.map((clip, i) => (
        <li key={clip.id} data-on={current?.id === clip.id ? "" : undefined} style={{ "--i": i } as CSSProperties}>
          <button type="button" className="vx-history-play" onClick={() => onPick(clip)} style={orbStyle(clip.voice.id)} aria-label={`Play ${clip.voice.name}`}>
            <PlayIcon size={11} />
          </button>
          <button type="button" className="vx-history-text" onClick={() => onPick(clip)}>
            <strong>{clip.text}</strong>
            <small>
              {clip.voice.name} · {clip.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </small>
          </button>
          <a className="vx-icon-btn" href={clip.url} download={`${fileNameFor(clip.voice, clip.text)}.mp3`} aria-label="Download MP3">
            <DownloadIcon size={15} />
          </a>
        </li>
      ))}
    </ul>
  );
}

/** What's left of this month's characters, as a line and a thin bar like ElevenLabs' quota meter. */
function AllowanceMeter({ left, allowance, resetsOn, short }: { left: number; allowance: number; resetsOn: string; short: boolean }) {
  const fmt = (n: number) => n.toLocaleString("en-US");
  const share = allowance > 0 ? left / allowance : 0;
  return (
    <div className="vs-allowance vx-allowance" data-low={share < 0.1 ? "" : undefined} title={`Resets on ${resetsOn}`}>
      <small>{short ? (left === 0 ? `All used · resets ${resetsOn}` : `Only ${fmt(left)} left this month`) : `${fmt(left)} / ${fmt(allowance)} characters left`}</small>
      <span className="vs-allowance-bar" aria-hidden="true">
        <span style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
    </div>
  );
}
