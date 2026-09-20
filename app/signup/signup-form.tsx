"use client";

import { useActionState } from "react";
import { completeSignup, type SignupState } from "./actions";

const initialState: SignupState = { error: null };

export function SignupForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState(completeSignup, initialState);

  return (
    <form action={action} className="stack" style={{ gap: 12 }}>
      <input type="hidden" name="token" value={token} />
      <label className="field">
        <span>Email</span>
        {/* Fixed: the invite was issued to this address, and the password is set on that account. */}
        <input type="email" value={email} readOnly aria-readonly="true" />
      </label>
      <label className="field">
        <span>Choose a password</span>
        <input type="password" name="password" autoComplete="new-password" minLength={10} required autoFocus placeholder="At least 10 characters" />
      </label>
      <label className="field">
        <span>Confirm password</span>
        <input type="password" name="confirm" autoComplete="new-password" minLength={10} required />
      </label>
      {state.error ? <p className="form-error">{state.error}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? "Setting up…" : "Create my account"}
      </button>
    </form>
  );
}
