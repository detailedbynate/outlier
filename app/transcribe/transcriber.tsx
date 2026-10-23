"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, ClipboardIcon, DownloadIcon, UploadIcon } from "@/components/icons";
import { SAMPLE_RATE } from "@/lib/transcribe/audio";
import { clock, toCaptions, toSrt, toVtt, type TimedWord } from "@/lib/transcribe/captions";

interface Result {
  name: string;
  url: string;
  text: string;
  words: TimedWord[];
  seconds: number;
}

type Stage = { kind: "idle" } | { kind: "reading"; name: string } | { kind: "transcribing"; name: string; seconds: number; since: number };

const STYLES = [
  { words: 1, label: "Word by word" },
  { words: 3, label: "Short" },
  { words: 6, label: "Lines" },
] as const;

/** Roughly how long the server takes per second of audio, for the progress bar. Measured ~0.2. */
const SECONDS_PER_SECOND = 0.25;

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
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [now, setNow] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
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

  const captions = useMemo(() => {
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
      const response = await fetch(`${endpoint}?language=${language}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: decoded.pcm.buffer as ArrayBuffer,
      });
      const body = (await response.json().catch(() => null)) as (Omit<Result, "name" | "url"> & { used: number | null; error?: string }) | null;
      if (!response.ok || !body || body.error) throw new Error(body?.error ?? "Couldn't transcribe that one. Try again in a moment.");
      if (body.used !== null) setUsed(body.used);
      if (!body.words.length) throw new Error("No speech found in that file.");
      setResult({ name: file.name, url: URL.createObjectURL(file), text: body.text, words: body.words, seconds: body.seconds });
      setTime(0);
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

  const seek = (seconds: number) => {
    if (!audio.current) return;
    audio.current.currentTime = seconds;
    void audio.current.play();
  };

  const progress = stage.kind === "transcribing" ? Math.min(0.95, (Math.max(now, stage.since) - stage.since) / 1000 / Math.max(3, stage.seconds * SECONDS_PER_SECOND)) : 0;
  const name = result ? baseName(result.name) : "transcript";

  return (
    <div className="tx">
      <section className="tx-main">
        {result && !busy ? (
          <>
            <div className="tx-file">
              <div className="tx-file-name">
                <strong>{result.name}</strong>
                <small>
                  {clock(result.seconds)} · {result.words.length.toLocaleString("en-US")} words
                </small>
              </div>
              <button type="button" className="vs-link" onClick={() => input.current?.click()}>
                Transcribe another
              </button>
            </div>
            <audio ref={audio} className="tx-audio" src={result.url} controls onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} />
            <div className="vs-tabs tx-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={view === "captions"} onClick={() => setView("captions")}>
                Captions<span className="vs-tab-count">{captions.length}</span>
              </button>
              <button type="button" role="tab" aria-selected={view === "text"} onClick={() => setView("text")}>
                Text
              </button>
            </div>
            {view === "captions" ? (
              <ol className="tx-captions">
                {captions.map((c, i) => (
                  <li key={i} data-on={time >= c.start && time < c.end ? "" : undefined}>
                    <button type="button" onClick={() => seek(c.start)}>
                      <span className="tx-time">{clock(c.start)}</span>
                      <span>{c.text}</span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="tx-text">
                {result.words.map((w, i) => (
                  <span key={i} data-on={time >= w.start && time < w.end ? "" : undefined} onClick={() => seek(w.start)}>
                    {w.text}{" "}
                  </span>
                ))}
              </p>
            )}
          </>
        ) : (
          <button
            type="button"
            className="tx-drop"
            data-dragging={dragging ? "" : undefined}
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
              <>
                <span className="vs-spinner tx-spinner" aria-hidden="true" />
                <strong>{stage.kind === "reading" ? "Reading the file…" : "Transcribing…"}</strong>
                <small>{stage.name}</small>
                {stage.kind === "transcribing" ? (
                  <span className="vs-allowance-bar tx-progress">
                    <span style={{ width: `${Math.round(progress * 100)}%` }} />
                  </span>
                ) : null}
              </>
            ) : (
              <>
                <span className="tx-drop-icon">
                  <UploadIcon size={22} />
                </span>
                <strong>Drop a voiceover here, or click to pick one</strong>
                <small>MP3, WAV, M4A or MP4 · up to {limitLabel(maxSeconds)}</small>
              </>
            )}
          </button>
        )}
        <input ref={input} type="file" accept="audio/*,video/mp4,video/quicktime,.mp3,.wav,.m4a,.aac,.ogg,.webm" hidden onChange={(e) => pick(e.target.files)} />
        {error ? <div className="dash-empty sw-error tx-error">{error}</div> : null}
      </section>

      <aside className="vs-side tx-side">
        <div className="vs-panel">
          <label className="vs-label" htmlFor="tx-language">
            Spoken language
          </label>
          <select id="tx-language" className="tx-select" value={language} onChange={(e) => setLanguage(e.target.value)} disabled={busy}>
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>

          <span className="vs-label">Caption style</span>
          <div className="vs-filters tx-styles">
            {STYLES.map((s) => (
              <button key={s.words} type="button" data-on={perCaption === s.words ? "" : undefined} onClick={() => setPerCaption(s.words)}>
                {s.label}
              </button>
            ))}
          </div>
          <label className="tx-range">
            <span>
              Up to {perCaption} {perCaption === 1 ? "word" : "words"} a caption
            </span>
            <input type="range" min={1} max={8} value={perCaption} onChange={(e) => setPerCaption(Number(e.target.value))} />
          </label>
          <label className="tx-check">
            <input type="checkbox" checked={upper} onChange={(e) => setUpper(e.target.checked)} /> ALL CAPS
          </label>
          <label className="tx-check">
            <input type="checkbox" checked={noPunctuation} onChange={(e) => setNoPunctuation(e.target.checked)} /> No punctuation
          </label>

          <span className="vs-label">Download</span>
          <div className="tx-downloads">
            <button type="button" className="btn btn-primary" disabled={!result} onClick={() => download(`${name}.srt`, toSrt(captions), "application/x-subrip")}>
              <DownloadIcon size={14} /> SRT
            </button>
            <button type="button" className="button-ghost" disabled={!result} onClick={() => download(`${name}.vtt`, toVtt(captions), "text/vtt")}>
              VTT
            </button>
            <button type="button" className="button-ghost" disabled={!result} onClick={() => download(`${name}.txt`, `${result?.text ?? ""}\n`, "text/plain")}>
              TXT
            </button>
          </div>
          <button
            type="button"
            className="button-ghost tx-copy"
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
          <p className="tx-note">SRT imports into CapCut, Premiere, DaVinci and YouTube Studio.</p>

          {allowance !== null && left !== null ? (
            <div className="vs-allowance tx-allowance" data-low={left < 60 ? "" : undefined}>
              <small>
                {clock(left)} of {allowance} min left today
              </small>
              <span className="vs-allowance-bar">
                <span style={{ width: `${Math.round((left / (allowance * 60)) * 100)}%` }} />
              </span>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
