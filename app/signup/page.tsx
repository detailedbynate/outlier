import type { Metadata } from "next";
import Link from "next/link";
import { getServices } from "@/lib/services";
import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Set up your account · Outlier" };

type SearchParams = Promise<{ token?: string }>;

/**
 * Where a paid subscriber lands from their email. The token is checked before
 * the form is shown, so a spent or expired link says so plainly instead of
 * failing after they've typed a password.
 */
export default async function SignupPage({ searchParams }: { searchParams: SearchParams }) {
  const { token } = await searchParams;
  const invite = token ? await getServices().repositories.signupInvites.find(token) : null;

  if (!invite) {
    return (
      <div className="card auth-card">
        <h1>This link has expired</h1>
        <p className="subtitle">
          Signup links work once and last a week. If you&apos;ve already set a password, sign in below — otherwise email us and we&apos;ll send a
          fresh one.
        </p>
        <Link href="/login" className="pill-button pill-button-primary pill-button-lg" style={{ width: "100%", justifyContent: "center" }}>
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="card auth-card">
      <h1>Set up your account</h1>
      <p className="subtitle">Pick a password and you&apos;re in. Your subscription is already active.</p>
      <SignupForm token={token!} email={invite.email} />
      <p className="stat-note" style={{ marginTop: 14, textAlign: "center" }}>
        By creating an account you agree to the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </div>
  );
}
