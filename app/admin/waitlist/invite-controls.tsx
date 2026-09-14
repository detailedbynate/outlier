"use client";

import { useActionState, useState } from "react";
import { inviteEntry, type InviteState } from "./actions";

const initialState: InviteState = { status: "idle", message: null, link: null };

export function InviteControls({ entryId, status }: { entryId: string; status: string }) {
  const [state, action, pending] = useActionState(inviteEntry, initialState);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!state.link) return;
    try {
      await navigator.clipboard.writeText(state.link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="invite-controls">
      <form action={action} className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
        <input type="hidden" name="entryId" value={entryId} />
        {status === "pending" ? (
          <button type="submit" name="mode" value="email" disabled={pending}>
            {pending ? "Sending…" : "Invite"}
          </button>
        ) : null}
        <button type="submit" name="mode" value="link" className="button-ghost" disabled={pending}>
          {status === "pending" ? "Get link" : "New link"}
        </button>
      </form>
      {state.message ? <p className={state.status === "error" ? "form-error" : "stat-note"}>{state.message}</p> : null}
      {state.link ? (
        <div className="invite-link">
          <input type="text" readOnly value={state.link} aria-label="Sign-in link" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="button-ghost" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
