"use client";

import { useActionState } from "react";
import { setPassword, type SetPasswordState } from "./actions";

const initialState: SetPasswordState = { error: null };

export function SetPasswordForm() {
  const [state, action, pending] = useActionState(setPassword, initialState);
  return (
    <form action={action} className="stack" style={{ gap: 12 }}>
      <label className="field">
        <span>New password</span>
        <input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required />
      </label>
      <label className="field">
        <span>Confirm password</span>
        <input name="confirm" type="password" autoComplete="new-password" minLength={8} maxLength={72} required />
      </label>
      {state.error ? <p className="form-error">{state.error}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save and continue"}
      </button>
    </form>
  );
}
