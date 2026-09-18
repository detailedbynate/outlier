"use client";

import { useActionState, useEffect, useRef } from "react";
import { changePassword, type ChangePasswordState } from "./actions";

const initial: ChangePasswordState = { status: "idle", message: null };

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePassword, initial);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "ok") form.current?.reset();
  }, [state]);

  return (
    <section className="card prefs-section password-section">
      <h2>Password</h2>
      <p className="stat-note">Change the password you sign in with.</p>
      <form ref={form} action={action} className="password-form">
        <label className="field">
          <span>Current password</span>
          <input name="current" type="password" autoComplete="current-password" maxLength={72} required />
        </label>
        <label className="field">
          <span>New password</span>
          <input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required />
        </label>
        <label className="field">
          <span>Confirm new password</span>
          <input name="confirm" type="password" autoComplete="new-password" minLength={8} maxLength={72} required />
        </label>
        <div className="password-actions">
          {state.message ? (
            <p className={state.status === "error" ? "form-error" : "prefs-saved"} role="status">
              {state.message}
            </p>
          ) : null}
          <button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Change password"}
          </button>
        </div>
      </form>
    </section>
  );
}
