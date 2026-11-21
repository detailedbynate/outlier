"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { ChevronRightIcon, ExternalIcon } from "@/components/icons";
import { formatCompact, formatMultiplier, timeAgo } from "@/lib/format";

export interface WatchItem {
  id: string;
  title: string;
  channel: string;
  channelId: string;
  short: boolean;
  score: number | null;
  views: number;
  perDay: number | null;
  published: string;
}

/**
 * Wraps a grid of video cards so clicking a thumbnail plays the video right
 * here instead of leaving for YouTube, with the numbers beside it and arrows
 * to step through the rest of the grid. A ctrl/cmd click still opens YouTube.
 */
export function WatchGrid({ items, children, className = "video-grid" }: { items: WatchItem[]; children: ReactNode; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [at, setAt] = useState<number | null>(null);
  const item = at === null ? null : items[at];

  useEffect(() => {
    const box = dialog.current;
    if (!box) return;
    if (at !== null && !box.open) box.showModal();
    if (at === null && box.open) box.close();
  }, [at]);

  const onGridClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest<HTMLAnchorElement>("a.video-thumb");
    if (!link) return;
    const id = new URL(link.href).searchParams.get("v");
    const index = items.findIndex((i) => i.id === id);
    if (index < 0) return;
    event.preventDefault();
    setAt(index);
  };

  const step = (by: number) => setAt((current) => (current === null ? null : (current + by + items.length) % items.length));

  const onKey = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "ArrowRight") step(1);
    else if (event.key === "ArrowLeft") step(-1);
  };

  return (
    <>
      <div className={className} onClick={onGridClick}>
        {children}
      </div>
      <dialog
        ref={dialog}
        className="vv-watch"
        aria-label={item ? `Watching ${item.title}` : "Watch video"}
        onClose={() => setAt(null)}
        onKeyDown={onKey}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        {item ? (
          <div className="vv-watch-body" data-short={item.short ? "" : undefined}>
            <div className="vv-watch-frame">
              <iframe
                key={item.id}
                src={`https://www.youtube-nocookie.com/embed/${item.id}?autoplay=1&rel=0&playsinline=1`}
                title={item.title}
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
              />
            </div>
            <aside className="vv-watch-info" key={item.id}>
              <div className="vv-watch-top">
                <span className="vv-watch-count">
                  {at! + 1} of {items.length}
                </span>
                <button type="button" className="vv-watch-close" onClick={() => dialog.current?.close()} aria-label="Close" autoFocus>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
              {item.score !== null ? (
                <p className="vv-watch-score">
                  <strong>{formatMultiplier(item.score)}</strong>
                  <span>its channel&apos;s usual views</span>
                </p>
              ) : null}
              <h2>{item.title}</h2>
              <Link href={`/channels/${item.channelId}`} className="vv-watch-channel">
                {item.channel}
              </Link>
              <dl className="vv-watch-stats">
                <div>
                  <dt>Views</dt>
                  <dd>{formatCompact(item.views)}</dd>
                </div>
                <div>
                  <dt>Per day</dt>
                  <dd>{formatCompact(item.perDay)}</dd>
                </div>
                <div>
                  <dt>Posted</dt>
                  <dd>{timeAgo(item.published)}</dd>
                </div>
              </dl>
              <a className="vv-watch-yt" href={`https://www.youtube.com/watch?v=${item.id}`} target="_blank" rel="noreferrer">
                Open on YouTube <ExternalIcon size={14} />
              </a>
              <div className="vv-watch-nav">
                <button type="button" onClick={() => step(-1)} aria-label="Previous video">
                  <ChevronRightIcon size={16} />
                </button>
                <button type="button" onClick={() => step(1)} aria-label="Next video">
                  <ChevronRightIcon size={16} />
                </button>
                <span className="vv-watch-hint">
                  <kbd>←</kbd> <kbd>→</kbd> to move · <kbd>Esc</kbd> to close
                </span>
              </div>
            </aside>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
