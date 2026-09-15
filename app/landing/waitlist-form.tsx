"use client";

import { useActionState } from "react";
import { joinWaitlist, type WaitlistState } from "./actions";

const initialState: WaitlistState = { status: "idle", message: null };

function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function WaitlistForm() {
  const [state, action, pending] = useActionState(joinWaitlist, initialState);

  if (state.status === "joined") {
    return (
      <div className="waitlist-success" role="status">
        <div className="waitlist-success-mark" aria-hidden="true">
          ✓
        </div>
        <p className="landing-subtitle">{state.message}</p>
      </div>
    );
  }

  return (
    <form action={action} className="waitlist-form">
      <label className="input-icon">
        <span className="sr-only">Your name</span>
        <UserIcon />
        <input name="name" type="text" autoComplete="name" placeholder="Your name" maxLength={100} />
      </label>
      <label className="input-icon">
        <span className="sr-only">Email address</span>
        <MailIcon />
        <input name="email" type="email" autoComplete="email" placeholder="Email address" required maxLength={254} />
      </label>
      {/* Honeypot for bots — hidden from people and assistive tech. */}
      <input name="company" type="text" tabIndex={-1} autoComplete="off" className="honeypot" aria-hidden="true" />
      <input name="source" type="hidden" value="landing" />
      {state.status === "error" && state.message ? <p className="form-error">{state.message}</p> : null}
      <button type="submit" className="waitlist-submit" disabled={pending}>
        <span>{pending ? "Joining…" : "Join the waitlist"}</span>
        <ArrowIcon />
      </button>
      <p className="waitlist-legal">
        By joining you agree to our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.
      </p>
    </form>
  );
}
