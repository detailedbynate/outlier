"use client";

import { useActionState } from "react";
import { CompassIcon } from "@/components/icons";
import { discoverShortsChannels, type DiscoverState } from "./actions";

const initialState: DiscoverState = { message: null, error: null };

/** Pull new Shorts channels from YouTube for a keyword (uses the daily discovery allowance). */
export function DiscoverForm({ keyword, searchesLeft }: { keyword: string; searchesLeft: number }) {
  const [state, action, pending] = useActionState(discoverShortsChannels, initialState);
  const disabled = searchesLeft <= 0;

  return (
    <form action={action} className="discover-banner">
      <div className="discover-copy">
        <CompassIcon size={18} />
        <div>
          <strong>Find more channels on YouTube</strong>
          <div className="stat-note">
            {disabled
              ? "Daily discovery limit reached. Resets at midnight UTC."
              : `Adds channels behind the most-viewed Shorts from the last 90 days · ${searchesLeft} left today`}
          </div>
        </div>
      </div>
      <div className="form discover-controls">
        <label htmlFor="discover-keyword" className="sr-only">
          Niche keyword
        </label>
        <input
          id="discover-keyword"
          name="keyword"
          type="text"
          defaultValue={keyword}
          key={keyword}
          placeholder="Niche, e.g. cooking hacks"
          minLength={2}
          maxLength={100}
          required
          disabled={disabled}
        />
        <button type="submit" disabled={pending || disabled}>
          {pending ? "Discovering…" : "Discover"}
        </button>
      </div>
      {pending ? <p className="notice discover-status">Searching YouTube and adding channels. This can take up to a minute.</p> : null}
      {!pending && state.message ? <p className="notice discover-status">{state.message}</p> : null}
      {!pending && state.error ? <p className="form-error discover-status">{state.error}</p> : null}
    </form>
  );
}
