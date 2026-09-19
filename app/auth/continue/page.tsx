import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isLinkType } from "@/lib/auth/links";
import { verifySignInLink } from "./actions";
import { ContinueButton } from "./continue-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Continue · Outlier", robots: { index: false } };

type SearchParams = Promise<{ token_hash?: string; type?: string; next?: string }>;

const COPY: Record<string, { title: string; body: string }> = {
  invite: { title: "You're invited to Outlier", body: "Tap continue to open your account and choose a password." },
  recovery: { title: "Set a new password", body: "Tap continue to sign in and choose a new password." },
};
const DEFAULT_COPY = { title: "Sign in to Outlier", body: "Tap continue to finish signing in." };

/**
 * The step between a sign-in link and using it. Link previews load this page
 * but never press the button, so the one-time link survives until the person does.
 */
export default async function ContinuePage({ searchParams }: { searchParams: SearchParams }) {
  const { token_hash: tokenHash, type, next } = await searchParams;
  if (!tokenHash || !isLinkType(type)) redirect("/login?error=link");
  const copy = COPY[type] ?? DEFAULT_COPY;

  return (
    <div className="card auth-card">
      <h1>{copy.title}</h1>
      <p className="subtitle">{copy.body}</p>
      <form action={verifySignInLink} className="stack" style={{ gap: 12 }}>
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <ContinueButton />
      </form>
    </div>
  );
}
