"use client";

import Link from "next/link";
import { useActionState } from "react";
import { joinWaitlist, type WaitlistState } from "./actions";

const initialState: WaitlistState = { status: "idle", message: null, position: null };

export function WaitlistForm() {
  const [state, action, pending] = useActionState(joinWaitlist, initialState);

  if (state.status === "joined") {
    return (
      <div className="waitlist-success" role="status">
        <div className="waitlist-success-mark" aria-hidden="true">
          ✓
        </div>
        {state.position ? (
          <p className="waitlist-position">
            You&apos;re <span className="gradient-text">#{state.position.toLocaleString()}</span> on the list
          </p>
        ) : null}
        <p className="subtitle">{state.message}</p>
      </div>
    );
  }

  return (
    <form action={action} className="waitlist-form">
      <label className="field">
        <span>Email</span>
        <input name="email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} />
      </label>
      <div className="waitlist-grid">
        <label className="field">
          <span>
            Your channel <span className="muted">(optional)</span>
          </span>
          <input name="channelUrl" type="text" placeholder="youtube.com/@yourchannel" maxLength={300} />
        </label>
        <label className="field">
          <span>
            Niche <span className="muted">(optional)</span>
          </span>
          <input name="niche" type="text" placeholder="e.g. gaming, finance, cooking" maxLength={100} />
        </label>
      </div>
      <label className="field">
        <span>
          What would you use Outlier for? <span className="muted">(optional)</span>
        </span>
        <select name="useCase" defaultValue="">
          <option value="">Choose one</option>
          <option value="Starting a new channel">Starting a new channel</option>
          <option value="Growing my channel">Growing my channel</option>
          <option value="Faceless / automation channels">Faceless / automation channels</option>
          <option value="Agency or managing clients">Agency or managing clients</option>
          <option value="Research and trends">Research and trends</option>
        </select>
      </label>
      {/* Honeypot for bots — hidden from people and assistive tech. */}
      <input name="company" type="text" tabIndex={-1} autoComplete="off" className="honeypot" aria-hidden="true" />
      <input name="source" type="hidden" value="landing" />
      {state.status === "error" && state.message ? <p className="form-error">{state.message}</p> : null}
      <button type="submit" className="button-lg" disabled={pending}>
        {pending ? "Joining…" : "Join the waitlist"}
      </button>
      <p className="stat-note waitlist-privacy">
        We&apos;ll only email you about your Outlier invite and launch. No spam. <Link href="/privacy">Privacy</Link>
      </p>
    </form>
  );
}
