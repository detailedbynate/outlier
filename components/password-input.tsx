"use client";

import { useState, type InputHTMLAttributes } from "react";
import { AuthInput } from "@/components/auth-split";

/** A password field with a lock icon and a show/hide button. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <AuthInput icon="lock">
      <input {...props} type={shown ? "text" : "password"} />
      <button type="button" className="auth-eye" onClick={() => setShown((s) => !s)} aria-label={shown ? "Hide password" : "Show password"} aria-pressed={shown}>
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
          <circle cx="12" cy="12" r="3" />
          {shown ? null : <path d="M4 4l16 16" />}
        </svg>
      </button>
    </AuthInput>
  );
}
