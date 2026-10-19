"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { DownloadIcon, PauseIcon, PlayIcon } from "@/components/icons";

const BARS = 96;

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
 * The player under the editor: play, the clip's own waveform (click to jump),
 * and download. Starts playing as soon as a new clip arrives.
 */
export function WavePlayer({ src, bytes, fileName, autoPlay = false }: { src: string; bytes: ArrayBuffer; fileName: string; autoPlay?: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let live = true;
    peaksOf(bytes)
      .then((p) => live && setPeaks(p))
      // A browser that can't decode it still plays it; it just gets flat bars.
      .catch(() => live && setPeaks(Array.from({ length: BARS }, () => 0.3)));
    return () => {
      live = false;
    };
  }, [bytes]);

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

  const seek = (event: PointerEvent<HTMLDivElement>) => {
    const el = audio.current;
    if (!el || !duration) return;
    const box = event.currentTarget.getBoundingClientRect();
    el.currentTime = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1) * duration;
    setAt(el.currentTime);
  };

  const progress = duration ? at / duration : 0;

  return (
    <div className="vs-wave">
      <audio
        ref={audio}
        src={src}
        autoPlay={autoPlay}
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
      <button type="button" className="vs-play" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
        {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
      </button>
      <div className="vs-bars" onPointerDown={seek} role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(at)} tabIndex={-1}>
        {(peaks ?? Array.from({ length: BARS }, () => 0.06)).map((p, i) => (
          <span key={i} data-on={i / BARS < progress ? "" : undefined} style={{ "--h": p } as CSSProperties} />
        ))}
      </div>
      <span className="vs-time">
        {time(at)} / {time(duration)}
      </span>
      <a className="vs-icon-btn" href={src} download={`${fileName}.mp3`} aria-label="Download MP3" title="Download MP3">
        <DownloadIcon size={17} />
      </a>
    </div>
  );
}
