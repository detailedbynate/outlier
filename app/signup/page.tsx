import type { Metadata } from "next";
import Link from "next/link";
import { AuthSplit } from "@/components/auth-split";
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
      <AuthSplit>
        <h1 className="auth-title">This link has expired</h1>
        <p className="auth-sub">
          Signup links work once and last a week. If you&apos;ve already set a password, sign in below — otherwise email us and we&apos;ll send a
          fresh one.
        </p>
        <Link href="/login" className="auth-alt auth-alt-primary">
          Go to sign in
        </Link>
      </AuthSplit>
    );
  }

  return (
    <AuthSplit>
      <h1 className="auth-title">Set up your account</h1>
      <p className="auth-sub">Pick a password and you&apos;re in. Your subscription is already active.</p>
      <SignupForm token={token!} email={invite.email} />
      <p className="auth-legal">
        By creating an account you agree to the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </AuthSplit>
  );
}
