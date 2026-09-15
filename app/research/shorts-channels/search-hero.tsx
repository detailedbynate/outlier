"use client";

import { useActionState, useState } from "react";
import { CompassIcon, SearchIcon } from "@/components/icons";
import { discoverShortsChannels, type DiscoverState } from "./actions";

const initialState: DiscoverState = { message: null, error: null };

/**
 * One search bar for the page: typing searches the channels we already have,
 * and the same keyword can be sent to YouTube to pull in new ones.
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
  const [keyword, setKeyword] = useState(query);
  const [state, action, pending] = useActionState(discoverShortsChannels, initialState);
  const outOfSearches = searchesLeft <= 0;
  const canDiscover = keyword.trim().length >= 2 && !outOfSearches;

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
        <form action={action} className="search-hero-discover">
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
      <p className="stat-note search-hero-note">
        {outOfSearches
          ? "Daily discovery limit reached. Resets at midnight UTC."
          : "Searches saved channels as you type. “Find new on YouTube” adds channels behind the most-viewed Shorts from the last 90 days · 10 credits."}
      </p>
      {pending ? <p className="notice discover-status">Searching YouTube and adding channels. This can take up to a minute.</p> : null}
      {!pending && state.message ? <p className="notice discover-status">{state.message}</p> : null}
      {!pending && state.error ? <p className="form-error discover-status">{state.error}</p> : null}
    </div>
  );
}
