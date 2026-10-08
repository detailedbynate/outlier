"use client";

import { useActionState } from "react";
import { postPicksNow, syncAllRoles, type DiscordFormState } from "./actions";

const initial: DiscordFormState = { status: "idle", message: null, sent: 0 };

function Result({ state }: { state: DiscordFormState }) {
  if (!state.message) return null;
  return (
    <p className={state.status === "error" ? "form-error" : "dc-sent"} role="status">
      {state.message}
    </p>
  );
}

export function PicksButton({ channels, defaultChannel }: { channels: { id: string; name: string }[]; defaultChannel: string | null }) {
  const [state, action, pending] = useActionState(postPicksNow, initial);
  return (
    <form action={action} className="dc-tool">
      <div>
        <strong>Daily Picks</strong>
        <p className="stat-note">Posted by itself each day once the picks are ready{defaultChannel ? "" : " (set DISCORD_PICKS_CHANNEL_ID to turn that on)"}. Post them now too:</p>
      </div>
      <div className="dc-tool-row">
        <select name="channelId" defaultValue={defaultChannel ?? channels[0]?.id ?? ""} aria-label="Channel">
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              # {c.name}
            </option>
          ))}
        </select>
        <button type="submit" className="button-ghost" disabled={pending || channels.length === 0}>
          {pending ? "Posting…" : "Post today's picks"}
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}

export function SyncButton() {
  const [state, action, pending] = useActionState(syncAllRoles, initial);
  return (
    <form action={action} className="dc-tool">
      <div>
        <strong>Roles</strong>
        <p className="stat-note">Pro and Expert roles follow plan changes on their own, and get rechecked daily. Recheck everyone now:</p>
      </div>
      <div className="dc-tool-row">
        <button type="submit" className="button-ghost" disabled={pending}>
          {pending ? "Checking…" : "Sync all roles"}
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}
