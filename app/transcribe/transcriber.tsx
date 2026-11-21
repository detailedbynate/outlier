"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { CheckIcon, ClipboardIcon, DownloadIcon, PauseIcon, PlayIcon, UploadIcon } from "@/components/icons";
import { SAMPLE_RATE } from "@/lib/transcribe/audio";
import { clock, toCaptions, toSrt, toVtt, type Caption, type TimedWord } from "@/lib/transcribe/captions";

interface Result {
  name: string;
  url: string;
  text: string;
  words: TimedWord[];
  seconds: number;
  /** Loudness in slices, 0–1, for the player's waveform. */
  peaks: number[];
}

type Stage = { kind: "idle" } | { kind: "reading"; name: string } | { kind: "transcribing"; name: string; seconds: number; since: number };

const STYLES = [
  { words: 1, label: "Word by word" },
  { words: 3, label: "Short" },
  { words: 6, label: "Lines" },
] as const;

/** Roughly how long the server takes per second of audio, for the progress bar. Measured ~0.2. */
const SECONDS_PER_SECOND = 0.25;
const BARS = 140;

/**
 * Decode whatever the browser can play (mp3, wav, m4a, the audio of an mp4)
 * and resample it to the 16 kHz mono 16-bit PCM Whisper takes. Done here so
 * the server needs no ffmpeg and the upload is ~2 MB a minute.
 */
async function decodeToPcm(file: File): Promise<{ pcm: Int16Array; seconds: number }> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    const length = Math.ceil(decoded.duration * SAMPLE_RATE);
    const offline = new OfflineAudioContext(1, length, SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const mono = (await offline.startRendering()).getChannelData(0);
    const pcm = new Int16Array(mono.length);
    for (let i = 0; i < mono.length; i += 1) pcm[i] = Math.max(-1, Math.min(1, mono[i]!)) * 0x7fff;
    return { pcm, seconds: decoded.duration };
  } finally {
    void context.close();
  }
}

/** The waveform, from the PCM that's already been made for the upload. */
function peaksOf(pcm: Int16Array): number[] {
  const size = Math.max(1, Math.floor(pcm.length / BARS));
  const peaks = Array.from({ length: BARS }, (_, i) => {
    let max = 0;
    for (let j = i * size; j < Math.min(pcm.length, (i + 1) * size); j += 8) max = Math.max(max, Math.abs(pcm[j] ?? 0));
    return max;
  });
  const loudest = Math.max(...peaks, 1);
  return peaks.map((p) => Math.max(p / loudest, 0.06));
}

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

const baseName = (file: string) => file.replace(/\.[^.]+$/, "") || "transcript";

const limitLabel = (seconds: number) => (seconds < 120 ? `${seconds} seconds` : `${seconds / 60} minutes`);

/**
 * Transcribe: drop a voiceover in, get timed captions out.
 *
 * One surface like Voice Studio's: the file and its captions on the left, how
 * the captions are cut and the downloads on the right, and the audio in a bar
 * along the bottom. Playing it lights the caption being said and keeps it in
 * view; clicking a caption or a word jumps there.
 */
export function Transcriber({
  languages,
  maxSeconds,
  allowance,
  used: initialUsed,
  endpoint = "/api/transcribe",
}: {
  languages: { code: string; name: string }[];
  maxSeconds: number;
  /** Minutes a day, or null for no limit. */
  allowance: number | null;
  /** Seconds used today. */
  used: number;
  /** Where the audio goes: the members' route, or the free tool's. */
  endpoint?: string;
}) {
  const [language, setLanguage] = useState("en");
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [used, setUsed] = useState(initialUsed);
  const [perCaption, setPerCaption] = useState(3);
  const [upper, setUpper] = useState(false);
  const [noPunctuation, setNoPunctuation] = useState(false);
  const [view, setView] = useState<"captions" | "text">("captions");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [now, setNow] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const busy = stage.kind !== "idle";

  const left = allowance === null ? null : Math.max(0, allowance * 60 - used);

  // Keep the progress bar moving while the server works.
  useEffect(() => {
    if (stage.kind !== "transcribing") return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [stage.kind]);

  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);

  // Smooth time while playing, so highlights move with the voice rather than in quarter-second jumps.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      setTime(audio.current?.currentTime ?? 0);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const captions = useMemo<Caption[]>(() => {
    if (!result) return [];
    const words = result.words.map((w) => {
      let text = noPunctuation ? w.text.replace(/[.,!?;:"“”]+/g, "") : w.text;
      if (upper) text = text.toUpperCase();
      return { ...w, text };
    });
    // Sentence ends still split captions when punctuation is hidden: group first, then strip.
    const grouped = toCaptions(result.words, { maxWords: perCaption, maxSeconds: perCaption === 1 ? 1.5 : 3.5 });
    let i = 0;
    return grouped.map((c) => {
      const count = c.text.split(" ").length;
      const text = words.slice(i, i + count).map((w) => w.text).filter(Boolean).join(" ");
      i += count;
      return { ...c, text };
    });
  }, [result, perCaption, upper, noPunctuation]);

  const active = captions.findIndex((c) => time >= c.start && time < c.end);

  // While playing, keep the caption being said in view inside the list (never scrolls the page).
  useEffect(() => {
    if (!playing || active < 0) return;
    const box = list.current;
    const row = box?.children[active] as HTMLElement | undefined;
    if (!box || !row) return;
    const top = row.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    if (top < box.scrollTop || top + row.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTo({ top: Math.max(0, top - box.clientHeight / 3), behavior: "smooth" });
    }
  }, [active, playing]);

  const run = async (file: File) => {
    if (busy) return;
    setError(null);
    setStage({ kind: "reading", name: file.name });
    try {
      let decoded: { pcm: Int16Array; seconds: number };
      try {
        decoded = await decodeToPcm(file);
      } catch {
        throw new Error("Couldn't read that file. Try an mp3, wav or m4a.");
      }
      if (decoded.seconds > maxSeconds + 1) throw new Error(`That's ${clock(decoded.seconds)}. One go takes up to ${limitLabel(maxSeconds)}, so trim it or split it.`);
      if (left !== null && decoded.seconds > left) {
        throw new Error(left < 1 ? `You've used today's ${allowance} minutes. It resets at midnight UTC.` : `That's ${clock(decoded.seconds)} and you have ${clock(left)} left today.`);
      }
      setStage({ kind: "transcribing", name: file.name, seconds: decoded.seconds, since: Date.now() });
      const peaks = peaksOf(decoded.pcm);
      const response = await fetch(`${endpoint}?language=${language}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: decoded.pcm.buffer as ArrayBuffer,
      });
      const body = (await response.json().catch(() => null)) as (Omit<Result, "name" | "url" | "peaks"> & { used: number | null; error?: string }) | null;
      if (!response.ok || !body || body.error) throw new Error(body?.error ?? "Couldn't transcribe that one. Try again in a moment.");
      if (body.used !== null) setUsed(body.used);
      if (!body.words.length) throw new Error("No speech found in that file.");
      setResult({ name: file.name, url: URL.createObjectURL(file), text: body.text, words: body.words, seconds: body.seconds, peaks });
      setTime(0);
      setPlaying(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't transcribe that one.");
    } finally {
      setStage({ kind: "idle" });
      if (input.current) input.current.value = "";
    }
  };

  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (file) void run(file);
  };

  const seek = (seconds: number, play = true) => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = seconds;
    setTime(seconds);
    if (play) void el.play().catch(() => undefined);
  };

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  };

  const progress = stage.kind === "transcribing" ? Math.min(0.95, (Math.max(now, stage.since) - stage.since) / 1000 / Math.max(3, stage.seconds * SECONDS_PER_SECOND)) : 0;
  const name = result ? baseName(result.name) : "transcript";
  // What the preview shows: the caption being said, or the first one, or an example before there's a file.
  const sample = captions[active >= 0 ? active : 0]?.text ?? (upper ? "YOUR CAPTIONS LOOK LIKE THIS" : "Your captions look like this");
  const sampleWords = perCaption === 1 ? sample.split(" ")[0] : sample.split(" ").slice(0, perCaption).join(" ");
  const showing = result && !busy;

  return (
    <div className="tq" data-has-result={showing ? "" : undefined}>
      <section className="tq-main">
        {showing ? (
          <>
            <header className="tq-file">
              <div className="tq-file-name">
                <strong>{result.name}</strong>
                <small>
                  {clock(result.seconds)} · {result.words.length.toLocaleString("en-US")} words · {captions.length} captions
                </small>
              </div>
              <button type="button" className="tq-pill" onClick={() => input.current?.click()}>
                <UploadIcon size={13} /> Transcribe another
              </button>
            </header>

            <div className="tq-tabs" role="tablist" data-tab={view}>
              <button type="button" role="tab" aria-selected={view === "captions"} onClick={() => setView("captions")}>
                Captions <span className="tq-tab-count">{captions.length}</span>
              </button>
              <button type="button" role="tab" aria-selected={view === "text"} onClick={() => setView("text")}>
                Text
              </button>
              <span className="tq-tab-ink" aria-hidden="true" />
            </div>

            {view === "captions" ? (
              <ol className="tq-captions" ref={list} key={`${perCaption}-${upper}-${noPunctuation}`}>
                {captions.map((c, i) => (
                  <li key={i} data-on={i === active ? "" : undefined} data-past={active >= 0 && i < active ? "" : undefined} style={{ "--i": Math.min(i, 24) } as CSSProperties}>
                    <button type="button" onClick={() => seek(c.start)}>
                      <span className="tq-stamp">{clock(c.start)}</span>
                      <span className="tq-line">{c.text}</span>
                      <span className="tq-dur">{(c.end - c.start).toFixed(1)}s</span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="tq-text">
                {result.words.map((w, i) => (
                  <span key={i} data-on={time >= w.start && time < w.end ? "" : undefined} data-past={time >= w.end ? "" : undefined} onClick={() => seek(w.start)}>
                    {w.text}{" "}
                  </span>
                ))}
              </p>
            )}
          </>
        ) : (
          <button
            type="button"
            className="tq-drop"
            data-dragging={dragging ? "" : undefined}
            data-busy={busy ? "" : undefined}
            disabled={busy}
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pick(e.dataTransfer.files);
            }}
          >
            {busy ? (
              <span className="tq-working" role="status">
                <span className="tq-wave" aria-hidden="true">
                  {Array.from({ length: 28 }, (_, i) => (
                    <i key={i} style={{ "--i": i } as CSSProperties} />
                  ))}
                </span>
                <strong className="tq-shimmer">{stage.kind === "reading" ? "Reading the file…" : "Transcribing…"}</strong>
                <small>
                  {stage.name}
                  {stage.kind === "transcribing" ? ` · ${clock(stage.seconds)}` : ""}
                </small>
                <span className="tq-steps" aria-hidden="true">
                  <span data-on="">Read</span>
                  <span data-on={stage.kind === "transcribing" ? "" : undefined}>Transcribe</span>
                  <span data-on={progress > 0.6 ? "" : undefined}>Time every word</span>
                </span>
                {stage.kind === "transcribing" ? (
                  <span className="tq-progress">
                    <span style={{ transform: `scaleX(${progress})` }} />
                  </span>
                ) : null}
              </span>
            ) : (
              <>
                <span className="tq-drop-icon">
                  <UploadIcon size={22} />
                </span>
                <strong>{dragging ? "Let go to transcribe it" : "Drop a voiceover here, or click to pick one"}</strong>
                <small>MP3, WAV, M4A or MP4 · up to {limitLabel(maxSeconds)}</small>
                <span className="tq-gets">
                  <span>Every word timed</span>
                  <span>SRT, VTT or TXT</span>
                  <span>CapCut, Premiere, YouTube</span>
                </span>
              </>
            )}
          </button>
        )}
        <input ref={input} type="file" accept="audio/*,video/mp4,video/quicktime,.mp3,.wav,.m4a,.aac,.ogg,.webm" hidden onChange={(e) => pick(e.target.files)} />
        {error ? <div className="dash-empty sw-error tq-error">{error}</div> : null}
      </section>

      <aside className="tq-side">
        <div className="tq-field">
          <label className="tq-label" htmlFor="tx-language">
            Spoken language
          </label>
          <select id="tx-language" className="tq-select" value={language} onChange={(e) => setLanguage(e.target.value)} disabled={busy}>
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        <div className="tq-field">
          <span className="tq-label">Caption style</span>
          <div className="tq-seg" style={{ "--seg": STYLES.findIndex((s) => s.words === perCaption) } as CSSProperties} data-custom={STYLES.some((s) => s.words === perCaption) ? undefined : ""}>
            {STYLES.map((s) => (
              <button key={s.words} type="button" data-on={perCaption === s.words ? "" : undefined} onClick={() => setPerCaption(s.words)}>
                {s.label}
              </button>
            ))}
            <span className="tq-seg-ink" aria-hidden="true" />
          </div>
          <label className="tq-range">
            <span>
              Up to <strong>{perCaption}</strong> {perCaption === 1 ? "word" : "words"} a caption
            </span>
            <input
              className="sw-slider tq-slider"
              type="range"
              min={1}
              max={8}
              value={perCaption}
              onChange={(e) => setPerCaption(Number(e.target.value))}
              style={{ "--filled": (perCaption - 1) / 7 } as CSSProperties}
            />
          </label>
          <div className="tq-preview" aria-label="Caption preview">
            <span key={sampleWords} className="tq-preview-line">
              {sampleWords}
            </span>
          </div>
          <Toggle label="ALL CAPS" on={upper} onChange={setUpper} />
          <Toggle label="No punctuation" on={noPunctuation} onChange={setNoPunctuation} />
        </div>

        <div className="tq-field">
          <span className="tq-label">Download</span>
          <div className="tq-downloads">
            <button type="button" className="btn btn-primary" disabled={!result} onClick={() => download(`${name}.srt`, toSrt(captions), "application/x-subrip")}>
              <DownloadIcon size={14} /> SRT
            </button>
            <button type="button" className="tq-btn" disabled={!result} onClick={() => download(`${name}.vtt`, toVtt(captions), "text/vtt")}>
              VTT
            </button>
            <button type="button" className="tq-btn" disabled={!result} onClick={() => download(`${name}.txt`, `${result?.text ?? ""}\n`, "text/plain")}>
              TXT
            </button>
          </div>
          <button
            type="button"
            className="tq-btn tq-copy"
            data-copied={copied ? "" : undefined}
            disabled={!result}
            onClick={() => {
              if (!result) return;
              void navigator.clipboard.writeText(result.text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1_500);
              });
            }}
          >
            {copied ? <CheckIcon size={14} /> : <ClipboardIcon size={14} />} {copied ? "Copied" : "Copy text"}
          </button>
          <p className="tq-note">SRT imports into CapCut, Premiere, DaVinci and YouTube Studio.</p>
        </div>

        {allowance !== null && left !== null ? (
          <div className="vs-allowance tq-allowance" data-low={left < 60 ? "" : undefined}>
            <small>
              {clock(left)} of {allowance} min left today
            </small>
            <span className="vs-allowance-bar">
              <span style={{ width: `${Math.round((left / (allowance * 60)) * 100)}%` }} />
            </span>
          </div>
        ) : null}
      </aside>

      {showing ? (
        <div className="tq-player">
          <audio
            ref={audio}
            src={result.url}
            preload="auto"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          />
          <button type="button" className="tq-play" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <PauseIcon size={17} /> : <PlayIcon size={17} />}
          </button>
          <Waveform peaks={result.peaks} duration={result.seconds} time={time} captions={captions} onSeek={(s) => seek(s, playing)} onToggle={toggle} />
          <span className="tq-time">
            {clock(time)} <span>/ {clock(result.seconds)}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="tq-toggle" onClick={() => onChange(!on)}>
      <span>{label}</span>
      <span className="tq-switch" aria-hidden="true" />
    </button>
  );
}

/** The file's waveform with a tick where each caption starts: click or drag to jump, arrows to step. */
function Waveform({
  peaks,
  duration,
  time,
  captions,
  onSeek,
  onToggle,
}: {
  peaks: number[];
  duration: number;
  time: number;
  captions: Caption[];
  onSeek: (seconds: number) => void;
  onToggle: () => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const dragging = useRef(false);
  const progress = duration ? time / duration : 0;
  const shareAt = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1);
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      onSeek(Math.min(duration, Math.max(0, time + (event.key === "ArrowRight" ? 2 : -2))));
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      onToggle();
    }
  };

  return (
    <div
      className="tq-bars"
      role="slider"
      tabIndex={0}
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      aria-valuetext={`${clock(time)} of ${clock(duration)}`}
      onKeyDown={onKey}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        onSeek(shareAt(e) * duration);
      }}
      onPointerMove={(e) => {
        const share = shareAt(e);
        setHover(share);
        if (dragging.current) onSeek(share * duration);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerLeave={() => setHover(null)}
    >
      {peaks.map((p, i) => (
        <span key={i} data-on={i / peaks.length < progress ? "" : undefined} style={{ "--h": p, "--i": i } as CSSProperties} />
      ))}
      {duration
        ? captions.map((c, i) => <i key={i} className="tq-cue" style={{ "--x": c.start / duration } as CSSProperties} aria-hidden="true" />)
        : null}
      {hover !== null && duration ? (
        <span className="tq-scrub" style={{ "--x": hover } as CSSProperties} aria-hidden="true">
          <em>{clock(hover * duration)}</em>
        </span>
      ) : null}
    </div>
  );
}
