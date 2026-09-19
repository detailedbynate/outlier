"use client";

import { useFormStatus } from "react-dom";

/** Disables itself once pressed: a second press would try to spend the used link and fail. */
export function ContinueButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="button-brand" disabled={pending}>
      {pending ? "Signing in…" : "Continue"}
    </button>
  );
}
