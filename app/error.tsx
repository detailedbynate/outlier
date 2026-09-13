"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card empty">
      <h2>Something went wrong</h2>
      <p>{process.env.NODE_ENV === "development" ? error.message : "This page couldn't load. Check the server logs."}</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
