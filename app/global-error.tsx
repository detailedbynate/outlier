"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/** Last-resort boundary for errors in the root layout itself. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#07060d", color: "#f6f4ff", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 24, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ color: "#b9b3cf", marginBottom: 20 }}>We&apos;ve been notified and are looking into it.</p>
          <button
            type="button"
            onClick={reset}
            style={{ font: "inherit", fontWeight: 600, color: "#fff", background: "linear-gradient(135deg,#8b5cf6,#ec4899)", border: 0, borderRadius: 10, padding: "10px 18px", cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}