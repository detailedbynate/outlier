"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { DownloadIcon, PauseIcon, PlayIcon } from "@/components/icons";
import type { Voice } from "@/lib/voice/elevenlabs";
import { orbStyle } from "./orb";

const BARS = 120;

export interface Clip {
  id: number;
  url: string;
  bytes: ArrayBuffer;
  voice: Voice;
  text: string;
  at: Date;
}

export const fileNameFor = (voice: Voice, text: string) =>
  [voice.name, ...text.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim().split(/\s+/).slice(0, 5)].join("-").toLowerCase() || "voiceover";

/** Loudness of the audio in BARS slices, 0–1, for drawing its real waveform. */
async function peaksOf(bytes: ArrayBuffer): Promise<number[]> {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(bytes.slice(0));
    const data = buffer.getChannelData(0);
    const size = Math.floor(data.length / BARS);
    const peaks = Array.from({ length: BARS }, (_, i) => {
      let max = 0;
      for (let j = i * size; j < (i + 1) * size; j += 16) max = Math.max(max, Math.abs(data[j] ?? 0));
      return max;
    });
    const loudest = Math.max(...peaks, 0.01);
    return peaks.map((p) => Math.max(p / loudest, 0.06));
  } finally {
    void context.close();
  }
}

const time = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * The bar along the bottom of the studio. Empty, it says what it's for; while
 * a clip is being made it shows a waveform being drawn; with a clip it plays
 * it, shows its real waveform (click or drag to jump, arrows to step) and
 * offers the MP3.
 */
export function Player({ clip, pending }: { clip: Clip | null; pending: boolean }) {
  if (clip) return <Loaded key={clip.id} clip={clip} />;
  return (
    <div className="vx-player" data-state={pending ? "pending" : "empty"}>
      <span className="vx-orb vx-orb-idle" aria-hidden="true" />
      {pending ? (
        <>
          <span className="vx-player-hint vx-shimmer" role="status">
            Generating your audio…
          </span>
          <div className="vx-bars vx-bars-live" aria-hidden="true">
            {Array.from({ length: 48 }, (_, i) => (
              <span key={i} style={{ "--i": i } as CSSProperties} />
            ))}
          </div>
        </>
      ) : (
        <span className="vx-player-hint">
          Your audio plays here. <kbd>Ctrl</kbd> + <kbd>Enter</kbd> generates it.
        </span>
      )}
    </div>
  );
}

function Loaded({ clip }: { clip: Clip }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [duration, setDuration] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    let live = true;
    peaksOf(clip.bytes)
      .then((p) => live && setPeaks(p))
      // A browser that can't decode it still plays it; it just gets flat bars.
      .catch(() => live && setPeaks(Array.from({ length: BARS }, () => 0.3)));
    return () => {
      live = false;
    };
  }, [clip.bytes]);

  // Smooth progress while playing; timeupdate alone only ticks a few times a second.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      setAt(audio.current?.currentTime ?? 0);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  };

  const jumpTo = (share: number) => {
    const el = audio.current;
    if (!el || !duration) return;
    el.currentTime = Math.min(Math.max(share, 0), 1) * duration;
    setAt(el.currentTime);
  };

  const shareAt = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1);
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!duration) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      jumpTo((at + (event.key === "ArrowRight" ? 2 : -2)) / duration);
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      toggle();
    }
  };

  const progress = duration ? at / duration : 0;
  // The orb swells with how loud this moment of the clip is.
  const level = playing && peaks ? (peaks[Math.min(BARS - 1, Math.floor(progress * BARS))] ?? 0) : 0;

  return (
    <div className="vx-player" data-state="ready" data-playing={playing ? "" : undefined}>
      <audio
        ref={audio}
        src={clip.url}
        autoPlay
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setAt(duration);
        }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
      />
      <button type="button" className="vx-play" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
        {playing ? <PauseIcon size={17} /> : <PlayIcon size={17} />}
      </button>
      <div className="vx-player-who">
        <span className="vx-orb" data-live={playing ? "" : undefined} style={{ ...orbStyle(clip.voice.id), "--level": level } as CSSProperties} aria-hidden="true" />
        <span className="vx-who-text">
          <strong>{clip.voice.name}</strong>
          <small>{clip.text}</small>
        </span>
      </div>
      <div
        className="vx-bars"
        role="slider"
        tabIndex={0}
        aria-label="Position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(at)}
        aria-valuetext={`${time(at)} of ${time(duration)}`}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          jumpTo(shareAt(e));
        }}
        onPointerMove={(e) => {
          const share = shareAt(e);
          setHover(share);
          if (dragging.current) jumpTo(share);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerLeave={() => setHover(null)}
        style={{ "--progress": progress } as CSSProperties}
      >
        {(peaks ?? Array.from({ length: BARS }, () => 0.06)).map((p, i) => (
          <span key={i} data-on={i / BARS < progress ? "" : undefined} data-ahead={hover !== null && i / BARS < hover && i / BARS >= progress ? "" : undefined} style={{ "--h": p, "--i": i } as CSSProperties} />
        ))}
        {hover !== null && duration ? (
          <span className="vx-scrub" style={{ "--x": hover } as CSSProperties} aria-hidden="true">
            <em>{time(hover * duration)}</em>
          </span>
        ) : null}
      </div>
      <span className="vx-time">
        {time(at)} <span>/ {time(duration)}</span>
      </span>
      <a className="vx-icon-btn" href={clip.url} download={`${fileNameFor(clip.voice, clip.text)}.mp3`} aria-label="Download MP3" title="Download MP3">
        <DownloadIcon size={17} />
      </a>
    </div>
  );
}
