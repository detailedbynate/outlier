"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CompassIcon, SearchIcon } from "@/components/icons";
import { useTypewriter } from "@/components/use-typewriter";
import { discoverShortsChannels, type DiscoverState } from "./actions";

const initialState: DiscoverState = { message: null, error: null };
const AUTO_KEY = "outlier.shorts.autodiscover";

/** Example searches the placeholder types out, one after another. */
const PLACEHOLDERS = [
  'Search "recipe, cooking, food" to find food channels',
  'Try "clash royale" for Clash Royale creators',
  'Try "minecraft, roblox" to search two niches at once',
  'Try "skincare" or "gym motivation"',
  'Try "my singing monsters"',
] as const;

/** Auto-find is on unless this browser turned it off. */
const autoFind = {
  listeners: new Set<() => void>(),
  subscribe(listener: () => void) {
    autoFind.listeners.add(listener);
    return () => autoFind.listeners.delete(listener);
  },
  enabled(): boolean {
    try {
      return window.localStorage.getItem(AUTO_KEY) !== "off";
    } catch {
      // Private browsing: on for this visit.
      return true;
    }
  },
  set(enabled: boolean) {
    try {
      window.localStorage.setItem(AUTO_KEY, enabled ? "on" : "off");
    } catch {
      // Not remembering the choice is fine.
    }
    for (const listener of autoFind.listeners) listener();
  },
};

/**
 * One search bar for the page: typing searches the channels we already have, and
 * the same keyword is sent to YouTube for channels nobody has pulled in yet.
 * That costs credits, so it can be switched off.
 */
export function SearchHero({
  query,
  hidden,
  searchesLeft,
}: {
  query: string;
  hidden: { name: string; value: string }[];
  searchesLeft: number;
}) {
  const router = useRouter();
  const [keyword, setKeyword] = useState(query);
  // Only animate while the placeholder is actually visible.
  const placeholder = useTypewriter(PLACEHOLDERS, keyword.length === 0);
  const auto = useSyncExternalStore(autoFind.subscribe, autoFind.enabled, () => true);
  const [state, action, pending] = useActionState(discoverShortsChannels, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const searchedFor = useRef<string | null>(null);
  const outOfSearches = searchesLeft <= 0;
  const canDiscover = keyword.trim().length >= 2 && !outOfSearches;

  // A search from the URL runs discovery once, so results include new channels.
  useEffect(() => {
    if (!auto || pending || query.trim().length < 2 || searchesLeft <= 0) return;
    if (searchedFor.current === query) return;
    searchedFor.current = query;
    formRef.current?.requestSubmit();
  }, [auto, pending, query, searchesLeft]);

  // Show the channels that discovery just added.
  const done = !pending && Boolean(state.message);
  useEffect(() => {
    if (done) router.refresh();
  }, [done, router, state.message]);

  const toggleAuto = () => autoFind.set(!auto);

  return (
    <div className="search-hero-block">
      <div className="search-hero">
        <form method="get" action="/research/shorts-channels" className="search-hero-form" role="search">
          <SearchIcon size={18} className="search-hero-icon" />
          <label htmlFor="q" className="sr-only">
            Search channels by niche
          </label>
          <input
            id="q"
            name="q"
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={placeholder}
            autoComplete="off"
          />
          {hidden.map((field) => (
            <input key={field.name} type="hidden" name={field.name} value={field.value} />
          ))}
        </form>
        <form action={action} className="search-hero-discover" ref={formRef}>
          <input type="hidden" name="keyword" value={keyword} />
          <button
            type="submit"
            className="toolbar-button"
            disabled={pending || !canDiscover}
            title={
              outOfSearches
                ? "Daily discovery limit reached. Resets at midnight UTC."
                : "Search YouTube for channels we don't have yet · 10 credits, 25 if it has to dig deeper"
            }
          >
            <CompassIcon size={15} />
            <span>{pending ? "Searching YouTube…" : "Find new on YouTube"}</span>
          </button>
        </form>
      </div>
      <div className="search-hero-meta">
        <button type="button" className={`auto-toggle ${auto ? "is-on" : ""}`} onClick={toggleAuto} aria-pressed={auto} disabled={outOfSearches}>
          <span className="auto-switch" aria-hidden="true">
            <span className="auto-switch-knob" />
          </span>
          <span className="auto-toggle-text">
            <strong>Auto-find new channels</strong>
            <span>
              {outOfSearches
                ? "Daily discovery limit reached — resets at midnight UTC"
                : auto
                  ? "Every search also pulls in channels nobody has found yet · 10 credits, 25 when it digs deeper"
                  : "Searching looks at saved channels only — tap to pull in new ones too"}
            </span>
          </span>
          <span className="auto-toggle-state">{auto ? "On" : "Off"}</span>
        </button>
      </div>
      {pending ? (
        <div className="discover-loading" role="status" aria-live="polite">
          <div className="discover-loading-head">
            <span className="discover-spinner" aria-hidden="true" />
            <div>
              <strong>Searching YouTube for {keyword.trim() || "new channels"}</strong>
              <p>Pulling in channels nobody has found yet, then checking their Shorts. This can take up to a minute.</p>
            </div>
          </div>
          <div className="discover-skeletons" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="discover-skeleton" style={{ animationDelay: `${i * 0.15}s` }}>
                <span className="discover-skeleton-avatar" />
                <span className="discover-skeleton-lines">
                  <span />
                  <span />
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {!pending && state.message ? <p className="notice discover-status">{state.message}</p> : null}
      {!pending && state.error ? <p className="form-error discover-status">{state.error}</p> : null}
    </div>
  );
}
