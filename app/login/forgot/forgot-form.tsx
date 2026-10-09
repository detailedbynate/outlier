"use client";

import { useActionState } from "react";
import { AuthInput } from "@/components/auth-split";
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
    <form action={action} className="auth-form">
      <label className="field">
        <span>Email</span>
        <AuthInput icon="mail">
          <input name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
        </AuthInput>
      </label>
      {state.status === "error" && state.message ? <p className="form-error">{state.message}</p> : null}
      <button type="submit" className="auth-submit" disabled={pending}>
        {pending ? "Sending…" : "Email me a reset link"}
      </button>
    </form>
  );
}
