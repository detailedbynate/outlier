"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn, type SignInState } from "./actions";

const initialState: SignInState = { error: null };

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, initialState);
  return (
    <form action={action} className="stack" style={{ gap: 12 }}>
      <input type="hidden" name="next" value={next} />
      <label className="field">
        <span>Email</span>
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label className="field">
        <span>Password</span>
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <Link href="/login/forgot" className="auth-forgot">
        Forgot password?
      </Link>
      {state.error ? <p className="form-error">{state.error}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
