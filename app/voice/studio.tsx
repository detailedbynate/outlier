"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from "react";
import { ChevronDownIcon, DownloadIcon, PauseIcon, PlayIcon, SearchIcon } from "@/components/icons";
import { DEFAULT_VOICE_SETTINGS, type Voice, type VoiceSettings } from "@/lib/voice/elevenlabs";
import { generateVoice } from "./actions";
import { WavePlayer } from "./wave-player";
import { orbStyle } from "./orb";

export interface ScriptOption {
  id: string;
  label: string;
  text: string;
}

interface Clip {
  id: number;
  url: string;
  bytes: ArrayBuffer;
  voice: Voice;
  text: string;
  at: Date;
}

/** Characters read per second at normal speed: about 2.8 words of ~5.7 characters. */
const CHARS_PER_SECOND = 16;

const fileNameFor = (voice: Voice, text: string) =>
  [voice.name, ...text.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim().split(/\s+/).slice(0, 5)].join("-").toLowerCase() || "voiceover";

const chips = (v: Voice) => [v.accent, v.gender, v.tone].filter((x): x is string => Boolean(x));

/**
 * The studio: write or paste on the left, pick a voice and how it reads on the
 * right, hear it underneath. Laid out like a text-to-speech app on purpose —
 * it's what people who've used one expect.
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
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [clips, setClips] = useState<Clip[]>([]);
  const [current, setCurrent] = useState<Clip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [used, setUsed] = useState(initialUsed);
  const [pending, start] = useTransition();
  const nextId = useRef(1);
  const voice = voices.find((v) => v.id === voiceId) ?? voices[0];

  const length = text.replace(/\s+/g, " ").trim().length;
  const left = allowance === null ? null : Math.max(0, allowance - used);
  const over = length > maxCharacters;
  // Past what's left this month: the button stays off and the meter says why.
  const overAllowance = left !== null && length > left;
  const seconds = Math.max(1, Math.round(length / CHARS_PER_SECOND / settings.speed));

  // Blob URLs hold audio in memory until they're let go.
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

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
    <div className="vs">
      <section className="vs-editor">
        <div className="vs-editor-top">
          {scripts.length > 0 ? (
            <label className="vs-script-pick">
              <span className="sr-only">Use one of your scripts</span>
              <select
                value=""
                onChange={(e) => {
                  const picked = scripts.find((s) => s.id === e.target.value);
                  if (picked) setText(picked.text);
                }}
              >
                <option value="">Use one of my scripts…</option>
                {scripts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <ChevronDownIcon size={14} />
            </label>
          ) : null}
          {text ? (
            <button type="button" className="vs-link" onClick={() => setText("")}>
              Clear
            </button>
          ) : null}
        </div>

        <textarea
          className="vs-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate();
          }}
          placeholder="Start typing here, or paste your script, and pick a voice on the right."
          spellCheck
          aria-label="Text to read out"
        />

        <div className="vs-editor-bar">
          <span className="vs-count" data-over={over ? "" : undefined}>
            {length.toLocaleString("en-US")} / {maxCharacters.toLocaleString("en-US")}
            {length > 0 ? <em> · about {seconds}s</em> : null}
          </span>
          <div className="vs-generate">
            {allowance !== null && left !== null ? <AllowanceMeter left={left} allowance={allowance} resetsOn={resetsOn} short={overAllowance} /> : null}
            <button type="button" className="btn btn-primary vs-go" onClick={generate} disabled={!voice || !length || over || overAllowance || pending}>
              {pending ? (
                <>
                  <span className="vs-spinner" aria-hidden="true" /> Generating…
                </>
              ) : (
                "Generate speech"
              )}
            </button>
          </div>
        </div>
        {error ? <div className="dash-empty sw-error vs-error">{error}</div> : null}
      </section>

      <aside className="vs-side">
        <div className="vs-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "settings"} onClick={() => setTab("settings")}>
            Settings
          </button>
          <button type="button" role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>
            History{clips.length ? <span className="vs-tab-count">{clips.length}</span> : null}
          </button>
        </div>

        {tab === "settings" ? (
          <div className="vs-panel">
            <span className="vs-label">Voice</span>
            {voice ? (
              <button type="button" className="vs-voice-current" onClick={() => setLibraryOpen(!libraryOpen)} aria-expanded={libraryOpen}>
                <span className="vs-orb" style={orbStyle(voice.id)} />
                <span className="vs-voice-text">
                  <strong>{voice.name}</strong>
                  <small>{chips(voice).join(" · ")}</small>
                </span>
                <ChevronDownIcon size={16} />
              </button>
            ) : null}
            {libraryOpen ? (
              <VoiceLibrary
                voices={voices}
                selected={voiceId}
                onPick={(id) => {
                  setVoiceId(id);
                  setLibraryOpen(false);
                }}
              />
            ) : null}

            <span className="vs-label">Model</span>
            <div className="vs-model">
              <strong>{model.name}</strong>
              <small>{model.note}</small>
            </div>

            <Slider label="Speed" left="Slower" right="Faster" min={0.7} max={1.2} step={0.05} value={settings.speed} onChange={(speed) => setSettings({ ...settings, speed })} />
            <Slider label="Stability" left="More expressive" right="More stable" min={0} max={1} step={0.05} value={settings.stability} onChange={(stability) => setSettings({ ...settings, stability })} />
            <Slider label="Style" left="None" right="Exaggerated" min={0} max={1} step={0.05} value={settings.style} onChange={(style) => setSettings({ ...settings, style })} />

            <button type="button" className="vs-link vs-reset" onClick={() => setSettings(DEFAULT_VOICE_SETTINGS)}>
              Reset values
            </button>
          </div>
        ) : (
          <History clips={clips} current={current} onPick={setCurrent} />
        )}
      </aside>

      <div className="vs-player" data-empty={current ? undefined : ""}>
        {current ? (
          <>
            <div className="vs-player-who">
              <span className="vs-orb" style={orbStyle(current.voice.id)} />
              <span className="vs-voice-text">
                <strong>{current.voice.name}</strong>
                <small>{current.text}</small>
              </span>
            </div>
            <WavePlayer key={current.id} src={current.url} bytes={current.bytes} fileName={fileNameFor(current.voice, current.text)} autoPlay />
          </>
        ) : (
          <span className="vs-player-hint">{pending ? "Generating your audio…" : "Your audio plays here. Ctrl + Enter generates too."}</span>
        )}
      </div>
    </div>
  );
}

function Slider({ label, left, right, min, max, step, value, onChange }: { label: string; left: string; right: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="vs-slider">
      <span className="vs-label">{label}</span>
      <input className="sw-slider" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ "--filled": (value - min) / (max - min) } as CSSProperties} />
      <span className="vs-slider-ends">
        <small>{left}</small>
        <small>{right}</small>
      </span>
    </label>
  );
}

/** Every stock voice: search, filter, hear the sample, pick. */
function VoiceLibrary({ voices, selected, onPick }: { voices: Voice[]; selected: string; onPick: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [gender, setGender] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const sample = useRef<HTMLAudioElement | null>(null);
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
    <div className="vs-library">
      <div className="vs-search">
        <SearchIcon size={14} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search voices" aria-label="Search voices" />
      </div>
      {genders.length > 1 ? (
        <div className="vs-filters">
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
      <ul className="vs-voice-list">
        {shown.map((v) => (
          <li key={v.id} data-on={v.id === selected ? "" : undefined}>
            <button type="button" className="vs-sample" onClick={() => preview(v)} disabled={!v.previewUrl} aria-label={`Hear ${v.name}`} style={orbStyle(v.id)}>
              {playing === v.id ? <PauseIcon size={12} /> : <PlayIcon size={12} />}
            </button>
            <button type="button" className="vs-voice-pick" onClick={() => onPick(v.id)}>
              <strong>{v.name}</strong>
              <small>{[v.accent, v.age, v.useCase].filter(Boolean).join(" · ")}</small>
            </button>
          </li>
        ))}
        {shown.length === 0 ? <li className="vs-none">No voices match.</li> : null}
      </ul>
    </div>
  );
}

function History({ clips, current, onPick }: { clips: Clip[]; current: Clip | null; onPick: (clip: Clip) => void }) {
  if (clips.length === 0) {
    return (
      <div className="vs-panel">
        <p className="vs-none">What you generate shows up here. It&apos;s kept until you leave the page, so download anything you want to keep.</p>
      </div>
    );
  }
  return (
    <ul className="vs-panel vs-history">
      {clips.map((clip) => (
        <li key={clip.id} data-on={current?.id === clip.id ? "" : undefined}>
          <button type="button" className="vs-history-play" onClick={() => onPick(clip)} style={orbStyle(clip.voice.id)} aria-label={`Play ${clip.voice.name}`}>
            <PlayIcon size={12} />
          </button>
          <span className="vs-voice-text">
            <strong>{clip.text}</strong>
            <small>
              {clip.voice.name} · {clip.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </small>
          </span>
          <a className="vs-icon-btn" href={clip.url} download={`${fileNameFor(clip.voice, clip.text)}.mp3`} aria-label="Download MP3">
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
    <div className="vs-allowance" data-low={share < 0.1 ? "" : undefined} title={`Resets on ${resetsOn}`}>
      <small>{short ? (left === 0 ? `All used · resets ${resetsOn}` : `Only ${fmt(left)} left this month`) : `${fmt(left)} / ${fmt(allowance)} characters left`}</small>
      <span className="vs-allowance-bar" aria-hidden="true">
        <span style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
    </div>
  );
}
