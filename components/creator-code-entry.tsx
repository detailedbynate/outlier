import { applyCreatorCode } from "@/app/landing/creator-code-action";

/** "Have a creator code?": collapsed, so it doesn't send people off hunting for codes. */
export function CreatorCodeEntry({ from, error = false }: { from: "landing" | "billing"; error?: boolean }) {
  return (
    <details className="creator-code-entry" open={error}>
      <summary>Have a creator code?</summary>
      <form action={applyCreatorCode} className="creator-code-form">
        <input type="hidden" name="from" value={from} />
        <input
          name="code"
          required
          minLength={2}
          maxLength={20}
          placeholder="Enter code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-label="Creator code"
          aria-invalid={error || undefined}
        />
        <button type="submit" className="pill-button pill-button-ghost">
          Apply
        </button>
      </form>
      {error ? (
        <p className="creator-code-error" role="alert">
          That code isn&apos;t valid. Check the spelling, or use the creator&apos;s link.
        </p>
      ) : null}
    </details>
  );
}
