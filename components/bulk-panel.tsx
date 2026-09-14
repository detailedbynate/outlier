"use client";

import { useActionState, useRef, useState, type ChangeEvent, type ReactNode } from "react";

export interface BulkState {
  status: "idle" | "ok" | "error";
  message: string | null;
  details?: string[];
}

export type BulkField = "duration" | "reason" | "limits";

export interface BulkOption {
  value: string;
  label: string;
  /** Asks for confirmation before running. */
  destructive?: boolean;
  fields?: BulkField[];
  /** Duration choices for this action (defaults to the panel's). */
  durations?: readonly { hours: number; label: string }[];
}

const initial: BulkState = { status: "idle", message: null };

/**
 * Select rows (checkboxes named `ids` inside `children`, linked to this form via
 * the `form` attribute) and apply one action to all of them.
 */
export function BulkPanel({
  formId,
  action,
  options,
  durations = [],
  children,
  noun = "item",
}: {
  formId: string;
  action: (prev: BulkState, formData: FormData) => Promise<BulkState>;
  options: BulkOption[];
  durations?: readonly { hours: number; label: string }[];
  children: ReactNode;
  noun?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  const [selected, setSelected] = useState(0);
  const [available, setAvailable] = useState(0);
  const [choice, setChoice] = useState(options[0]?.value ?? "");
  const tableRef = useRef<HTMLDivElement>(null);
  const option = options.find((o) => o.value === choice);
  const fields = new Set(option?.fields ?? []);
  const choices = option?.durations ?? durations;

  const boxes = () => [...(tableRef.current?.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="ids"][form="${formId}"]`) ?? [])];
  const recount = () => {
    const all = boxes();
    setSelected(all.filter((b) => b.checked).length);
    setAvailable(all.length);
  };
  const toggleAll = (event: ChangeEvent<HTMLInputElement>) => {
    for (const box of boxes()) box.checked = event.currentTarget.checked;
    recount();
  };

  return (
    <div className="bulk-panel">
      <form
        id={formId}
        action={formAction}
        className={`bulk-bar ${selected > 0 ? "has-selection" : ""}`}
        onSubmit={(event) => {
          if (selected === 0) {
            event.preventDefault();
            return;
          }
          if (option?.destructive && !window.confirm(`${option.label} ${selected} ${noun}${selected === 1 ? "" : "s"}? This can't be undone.`)) {
            event.preventDefault();
          }
        }}
      >
        <label className="checkbox-field bulk-select-all">
          <input type="checkbox" onChange={toggleAll} checked={selected > 0 && selected === available} aria-label="Select all" />
          <span>{selected > 0 ? `${selected} selected` : "Select all"}</span>
        </label>
        <select name="action" value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Action">
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {fields.has("duration") ? (
          <select key={choice} name="durationHours" defaultValue={choices[1]?.hours ?? choices[0]?.hours ?? ""} aria-label="Duration">
            {choices.map((d) => (
              <option key={d.hours} value={d.hours}>
                {d.label}
              </option>
            ))}
          </select>
        ) : null}
        {fields.has("limits") ? (
          <>
            <input name="dailyCredits" type="number" min={0} placeholder="Credits/day (blank = default)" aria-label="Daily credits" />
            <input name="youtubeDailyUnits" type="number" min={0} placeholder="YouTube units/day" aria-label="YouTube units per day" />
          </>
        ) : null}
        {fields.has("reason") ? <input name="reason" maxLength={500} placeholder="Reason (optional)" aria-label="Reason" /> : null}
        <button type="submit" className={option?.destructive ? "button-danger" : undefined} disabled={pending || selected === 0}>
          {pending ? "Applying…" : "Apply"}
        </button>
      </form>
      {state.message ? (
        <div className={state.status === "error" ? "form-error" : "stat-note"} role="status">
          {state.message}
          {state.details?.length ? (
            <ul className="bulk-details">
              {state.details.slice(0, 10).map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div ref={tableRef} onChange={recount}>
        {children}
      </div>
    </div>
  );
}
