"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { Voice } from "@/lib/voice/elevenlabs";
import { voiceScript } from "./actions";

export interface VoiceOptions {
  voices: Voice[];
  cost: number;
}

/**
 * "Read it out": pick a stock voice, hear its sample for free, then turn the
 * script into an MP3 to drop straight into the edit.
 */
export function Voiceover({ scriptId, options, fileName }: { scriptId: string; options: VoiceOptions; fileName: string }) {
  const { voices, cost } = options;
  const [voiceId, setVoiceId] = useState(voices[0]?.id ?? "");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const sample = useRef<HTMLAudioElement | null>(null);
  const voice = voices.find((v) => v.id === voiceId);

  // Blob URLs hold the audio in memory until they're let go.
  useEffect(() => () => void (audioUrl && URL.revokeObjectURL(audioUrl)), [audioUrl]);

  const playSample = () => {
    if (!voice?.previewUrl) return;
    sample.current?.pause();
    sample.current = new Audio(voice.previewUrl);
    void sample.current.play().catch(() => undefined);
  };

  const make = () =>
    start(async () => {
      setError(null);
      const result = await voiceScript(scriptId, voiceId);
      if (!result.audio) {
        setError(result.error);
        return;
      }
      const bytes = Uint8Array.from(atob(result.audio), (c) => c.charCodeAt(0));
      setAudioUrl(URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" })));
    });

  return (
    <section className="sw-voice">
      <div className="sw-voice-head">
        <h3>Voiceover</h3>
        <small>Have it read out, ready to drop into your edit.</small>
      </div>
      <div className="sw-voice-row">
        <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} aria-label="Voice" disabled={pending}>
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.description ? ` · ${v.description}` : ""}
            </option>
          ))}
        </select>
        {voice?.previewUrl ? (
          <button type="button" className="sw-copy" onClick={playSample}>
            Hear sample
          </button>
        ) : null}
        <button type="button" className="btn btn-primary sw-voice-make" onClick={make} disabled={pending || !voiceId}>
          {pending ? "Recording…" : audioUrl ? "Make another" : "Make voiceover"}
        </button>
        <small>{cost} credits</small>
      </div>
      {error ? <div className="dash-empty sw-error">{error}</div> : null}
      {audioUrl && !pending ? (
        <div className="sw-voice-out">
          <audio controls src={audioUrl} />
          <a className="sw-copy" href={audioUrl} download={`${fileName}.mp3`}>
            Download MP3
          </a>
        </div>
      ) : null}
    </section>
  );
}

/** A file name from the script's first words. */
export function voiceFileName(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join("-");
  return slug || "voiceover";
}
