"use client";

import Link from "next/link";
import { useActionState } from "react";
import { AuthInput } from "@/components/auth-split";
import { PasswordInput } from "@/components/password-input";
import { signIn, type SignInState } from "./actions";

const initialState: SignInState = { error: null };

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, initialState);
  return (
    <form action={action} className="auth-form">
      <input type="hidden" name="next" value={next} />
      <label className="field">
        <span>Email address</span>
        <AuthInput icon="mail">
          <input name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
        </AuthInput>
      </label>
      <label className="field">
        <span>Password</span>
        <PasswordInput name="password" autoComplete="current-password" placeholder="Your password" required />
      </label>
      <Link href="/login/forgot" className="auth-forgot">
        Forgot password?
      </Link>
      {state.error ? <p className="form-error">{state.error}</p> : null}
      <button type="submit" className="auth-submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
