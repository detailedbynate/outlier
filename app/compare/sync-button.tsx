"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

const STEPS = ["Checking saved data…", "Loading channels from YouTube…", "Pulling recent uploads…", "Crunching the numbers…"];

/** Submit button for the channel form: disables itself and shows progress while the refresh runs. */
export function SyncButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 2500);
    return () => {
      clearInterval(timer);
      setStep(0);
    };
  }, [pending]);

  return (
    <div className="sync-button">
      {pending ? (
        <span className="sync-status" role="status" aria-live="polite">
          <span className="sync-spinner" aria-hidden="true" />
          {STEPS[step]}
        </span>
      ) : null}
      <button type="submit" disabled={pending} aria-busy={pending}>
        {pending ? "Working…" : label}
      </button>
    </div>
  );
}