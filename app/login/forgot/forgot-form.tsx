"use client";

import { useActionState } from "react";
import { requestPasswordReset, type ResetState } from "./actions";

const initialState: ResetState = { status: "idle", message: null };

export function ForgotForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, initialState);

  if (state.status === "sent") {
    return (
      <p className="notice" role="status">
        {state.message}
      </p>
    );
  }

  return (
    <form action={action} className="stack" style={{ gap: 12 }}>
      <label className="field">
        <span>Email</span>
        <input name="email" type="email" autoComplete="email" required />
      </label>
      {state.status === "error" && state.message ? <p className="form-error">{state.message}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Email me a reset link"}
      </button>
    </form>
  );
}
