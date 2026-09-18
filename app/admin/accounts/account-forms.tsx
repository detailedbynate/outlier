"use client";

import { useActionState, useState } from "react";
import type { AccountRole } from "@/types/database";
import { adjustCredits, createAccount, updateAccount, type AccountFormState } from "./actions";

const initial: AccountFormState = { status: "idle", message: null, link: null };

function Status({ state }: { state: AccountFormState }) {
  const [copied, setCopied] = useState(false);
  if (!state.message) return null;
  return (
    <div className="account-status">
      <p className={state.status === "error" ? "form-error" : "stat-note"} role="status">
        {state.message}
      </p>
      {state.link ? (
        <div className="invite-link">
          <input readOnly value={state.link} onFocus={(e) => e.currentTarget.select()} aria-label="Sign-in link" />
          <button
            type="button"
            className="button-ghost"
            onClick={async () => {
              await navigator.clipboard.writeText(state.link!);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function CreateAccountForm({ canCreateAdmins, defaultCredits, defaultUnits }: { canCreateAdmins: boolean; defaultCredits: number; defaultUnits: number }) {
  const [state, action, pending] = useActionState(createAccount, initial);
  return (
    <form action={action} className="account-form">
      <label className="field">
        <span>Email</span>
        <input name="email" type="email" required placeholder="person@example.com" autoComplete="off" />
      </label>
      <label className="field">
        <span>Role</span>
        <select name="role" defaultValue="member">
          <option value="member">Member</option>
          {canCreateAdmins ? <option value="admin">Admin</option> : null}
        </select>
      </label>
      <label className="field">
        <span>Credits / month</span>
        <input name="monthlyCredits" type="number" min={0} placeholder={`Default (${defaultCredits})`} />
      </label>
      <label className="field">
        <span>YouTube units / day</span>
        <input name="youtubeDailyUnits" type="number" min={0} placeholder={`Default (${defaultUnits})`} />
      </label>
      <label className="field account-note">
        <span>Note</span>
        <input name="note" maxLength={500} placeholder="Optional, e.g. beta tester" />
      </label>
      <label className="field">
        <span>How to send access</span>
        <select name="delivery" defaultValue="link">
          <option value="link">Copy sign-in link</option>
          <option value="email">Send invite email</option>
        </select>
      </label>
      <div className="account-actions">
        <button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create account"}
        </button>
      </div>
      <Status state={state} />
    </form>
  );
}

export function EditAccountForm({
  account,
  canEditRole,
  locked,
  email,
}: {
  account: { user_id: string; role: AccountRole; daily_credits: number | null; youtube_daily_units: number | null; note: string | null; disabled: boolean };
  canEditRole: boolean;
  /** Owner rows (or admins when you're not the owner) can't be changed here. */
  locked: boolean;
  /** Whether a settings row exists yet (people who joined from the waitlist may not have one). */
  hasSettings?: boolean;
  email: string;
}) {
  const [state, action, pending] = useActionState(updateAccount, initial);
  return (
    <form action={action} className="account-edit">
      <input type="hidden" name="userId" value={account.user_id} />
      <input type="hidden" name="email" value={email} />
      {account.role === "owner" || !canEditRole ? (
        <input type="hidden" name="role" value={account.role} />
      ) : (
        <select name="role" defaultValue={account.role} aria-label="Role" disabled={locked}>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      )}
      <input name="monthlyCredits" type="number" min={0} defaultValue={account.daily_credits ?? ""} placeholder="Default" aria-label="Monthly credits" disabled={locked || account.role === "owner"} />
      <input name="youtubeDailyUnits" type="number" min={0} defaultValue={account.youtube_daily_units ?? ""} placeholder="Default" aria-label="YouTube units per day" disabled={locked || account.role === "owner"} />
      <input name="note" defaultValue={account.note ?? ""} placeholder="Note" aria-label="Note" maxLength={500} disabled={locked} />
      <button type="submit" className="button-ghost button-small" disabled={pending || locked}>
        {pending ? "Saving…" : "Save"}
      </button>
      <Status state={state} />
    </form>
  );
}
/** Owner only: add credits (positive) or take them back (negative). */
export function AdjustCreditsForm({ userId, extra }: { userId: string; extra: number }) {
  const [state, action, pending] = useActionState(adjustCredits, initial);
  return (
    <form action={action} className="account-edit credit-adjust">
      <input type="hidden" name="userId" value={userId} />
      <input name="amount" type="number" step={1} required placeholder="+100 or -50" aria-label={`Credits to add or remove (has ${extra} extra)`} />
      <input name="note" placeholder="Reason (optional)" aria-label="Reason" maxLength={200} />
      <button type="submit" className="button-ghost button-small" disabled={pending}>
        {pending ? "Saving…" : "Add / remove"}
      </button>
      <Status state={state} />
    </form>
  );
}
