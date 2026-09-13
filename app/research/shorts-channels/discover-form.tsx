"use client";

import { useActionState } from "react";
import { discoverShortsChannels, type DiscoverState } from "./actions";

const initialState: DiscoverState = { message: null, error: null };

export function DiscoverForm({ searchesLeft }: { searchesLeft: number }) {
  const [state, action, pending] = useActionState(discoverShortsChannels, initialState);
  return (
    <form action={action}>
      <div className="form">
        <label htmlFor="keyword" className="sr-only">
          Niche keyword
        </label>
        <input
          id="keyword"
          name="keyword"
          type="text"
          placeholder="Niche keyword, e.g. motivation, cooking hacks, minecraft"
          minLength={2}
          maxLength={100}
          required
          disabled={searchesLeft <= 0}
        />
        <button type="submit" disabled={pending || searchesLeft <= 0}>
          {pending ? "Discovering…" : "Discover channels"}
        </button>
      </div>
      {pending ? <p className="notice">Searching YouTube and adding channels. This can take up to a minute.</p> : null}
      {!pending && state.message ? <p className="notice">{state.message}</p> : null}
      {!pending && state.error ? <p className="form-error">{state.error}</p> : null}
      <p className="stat-note" style={{ marginTop: 8 }}>
        {searchesLeft > 0 ? `${searchesLeft} discovery searches left today` : "Daily discovery limit reached. Resets at midnight UTC."}
      </p>
    </form>
  );
}
