"use client";

import { useActionState } from "react";
import { trackChannel, type TrackChannelState } from "@/app/actions";

const initialState: TrackChannelState = { error: null };

export function TrackChannelForm() {
  const [state, action, pending] = useActionState(trackChannel, initialState);
  return (
    <form action={action}>
      <div className="form">
        <label htmlFor="identifier" className="sr-only">
          Channel
        </label>
        <input id="identifier" name="identifier" type="text" placeholder="@handle, channel URL, or UC… ID" required />
        <button type="submit" disabled={pending}>
          {pending ? "Tracking…" : "Track channel"}
        </button>
      </div>
      {state.error ? <p className="form-error">{state.error}</p> : null}
      {state.message ? <p className="stat-note">{state.message}</p> : null}
    </form>
  );
}
