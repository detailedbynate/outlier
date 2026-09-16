"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CompassIcon, SearchIcon } from "@/components/icons";
import { discoverShortsChannels, type DiscoverState } from "./actions";

const initialState: DiscoverState = { message: null, error: null };
const AUTO_KEY = "outlier.shorts.autodiscover";

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
            placeholder={'Search "recipe, cooking, food" to find food channels'}
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
                : "Search YouTube for channels we don't have yet · 10 credits"
            }
          >
            <CompassIcon size={15} />
            <span>{pending ? "Searching YouTube…" : "Find new on YouTube"}</span>
          </button>
        </form>
      </div>
      <div className="search-hero-meta">
        <button type="button" className={`auto-toggle ${auto ? "is-on" : ""}`} onClick={toggleAuto} aria-pressed={auto}>
          <span className="auto-toggle-dot" aria-hidden="true" />
          Auto-find new channels: {auto ? "On" : "Off"}
        </button>
        <p className="stat-note search-hero-note">
          {outOfSearches
            ? "Daily discovery limit reached. Resets at midnight UTC."
            : auto
              ? "Every search also pulls in channels nobody has found yet · 10 credits per search."
              : "Searching only looks at saved channels. Use “Find new on YouTube” to pull in new ones · 10 credits."}
        </p>
      </div>
      {pending ? <p className="notice discover-status">Searching YouTube and adding channels. This can take up to a minute.</p> : null}
      {!pending && state.message ? <p className="notice discover-status">{state.message}</p> : null}
      {!pending && state.error ? <p className="form-error discover-status">{state.error}</p> : null}
    </div>
  );
}
