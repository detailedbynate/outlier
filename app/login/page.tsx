import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthSplit } from "@/components/auth-split";
import { safeRedirectPath } from "@/lib/auth/access";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const target = safeRedirectPath(next);
  if (await getCurrentUser()) redirect(target);

  return (
    <AuthSplit
      pill="Shorts research, done for you"
      foot={
        <>
          New to Outlier? <Link href="/#pricing">See plans</Link>
        </>
      }
    >
      <h1 className="auth-title">Welcome back</h1>
      <p className="auth-sub">Sign in to see what&apos;s blowing up today.</p>
      {error === "link" ? <p className="form-error">That link expired or was already used. Ask for a new one, or sign in below.</p> : null}
      <LoginForm next={target} />
      <p className="auth-legal">
        By signing in you agree to the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </AuthSplit>
  );
}
