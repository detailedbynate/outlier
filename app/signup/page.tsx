import type { Metadata } from "next";
import Link from "next/link";
import { AuthSplit } from "@/components/auth-split";
import { getServices } from "@/lib/services";
import { hasNeverSignedIn } from "@/lib/billing/signup";
import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Set up your account · Outlier" };

type SearchParams = Promise<{ token?: string }>;

/**
 * Where a paid subscriber lands from their email. The token is checked before
 * the form is shown, so a link whose account is already set up says so plainly instead of
 * failing after they've typed a password.
 */
export default async function SignupPage({ searchParams }: { searchParams: SearchParams }) {
  const { token } = await searchParams;
  const invites = getServices().repositories.signupInvites;
  let invite = token ? await invites.find(token) : null;
  // Already got in some other way (a password reset, say): the account is set up, so the link is done.
  if (invite && !(await hasNeverSignedIn(invite.user_id))) {
    await invites.retire(invite.user_id);
    invite = null;
  }

  if (!invite) {
    return (
      <AuthSplit>
        <h1 className="auth-title">Your account is already set up</h1>
        <p className="auth-sub">
          This link stops working once your account has a password. Sign in below — and if you&apos;ve forgotten your password, you can reset it
          from there.
        </p>
        <Link href="/login" className="auth-alt auth-alt-primary">
          Go to sign in
        </Link>
      </AuthSplit>
    );
  }

  return (
    <AuthSplit
      pill="Your subscription is active"
      foot={
        <>
          Already set a password? <Link href="/login">Sign in</Link>
        </>
      }
    >
      <h1 className="auth-title">Set up your account</h1>
      <p className="auth-sub">Pick a password and you&apos;re in. Your subscription is already active.</p>
      <SignupForm token={token!} email={invite.email} />
      <p className="auth-legal">
        By creating an account you agree to the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </AuthSplit>
  );
}
