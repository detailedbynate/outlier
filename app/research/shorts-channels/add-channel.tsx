"use client";

import { useActionState } from "react";
import { addChannelForSimilar, type AddChannelState } from "./actions";

const initial: AddChannelState = { error: null };

/** Shown when someone asks for a channel we don't have: pull it in, then show it (or what's like it). */
export function AddChannel({ reference, cost, then = "similar" }: { reference: string; cost: number; then?: "similar" | "channel" }) {
  const [state, action, pending] = useActionState(addChannelForSimilar, initial);
  return (
    <form action={action} className="card similar-missing">
      <input type="hidden" name="reference" value={reference} />
      <input type="hidden" name="then" value={then} />
      <div>
        <strong>{reference} isn&apos;t in Outlier yet.</strong>
        <p className="stat-note">
          {then === "channel" ? "Add it to see its stats and uploads." : "Add it to see the channels most like it."} This reads the channel and its latest uploads from YouTube ({cost} credits).
        </p>
        {state.error ? (
          <p className="form-error" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
      <button type="submit" disabled={pending}>
        {pending ? "Adding…" : then === "channel" ? "Add channel" : "Add and find similar"}
      </button>
    </form>
  );
}
