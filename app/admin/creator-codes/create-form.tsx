"use client";

import { useActionState } from "react";
import { createCode, type CreatorCodeFormState } from "./actions";

const initial: CreatorCodeFormState = { status: "idle", message: null };

export function CreateCodeForm() {
  const [state, action, pending] = useActionState(createCode, initial);
  return (
    <form action={action} className="account-form">
      <label className="field">
        <span>Code</span>
        <input name="code" required minLength={2} maxLength={20} pattern="[A-Za-z0-9][A-Za-z0-9_\-]{1,19}" placeholder="NATE" autoComplete="off" />
      </label>
      <label className="field">
        <span>Creator</span>
        <input name="creatorName" required maxLength={100} placeholder="Channel or person" />
      </label>
      <label className="field">
        <span>Their Outlier email</span>
        <input name="email" type="email" placeholder="Optional: lets them see their numbers" autoComplete="off" />
      </label>
      <label className="field">
        <span>Discount %</span>
        <input name="discountPercent" type="number" min={1} max={100} defaultValue={20} required />
      </label>
      <label className="field">
        <span>For months</span>
        <input name="discountMonths" type="number" min={1} max={36} defaultValue={2} required />
      </label>
      <label className="field">
        <span>Commission %</span>
        <input name="commissionPercent" type="number" min={0} max={100} defaultValue={20} required />
      </label>
      <label className="field">
        <span>Commission months</span>
        <input name="commissionMonths" type="number" min={1} max={120} defaultValue={12} placeholder="Blank = as long as they pay" />
      </label>
      <div className="account-actions">
        <button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create code"}
        </button>
      </div>
      {state.message ? (
        <p className={state.status === "error" ? "form-error" : "stat-note"} role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
