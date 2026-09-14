"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="card empty">
      <h2>Something went wrong</h2>
      <p>{process.env.NODE_ENV === "development" ? error.message : "This page couldn't load. We've been notified."}</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </div>
  );
}