import Link from "next/link";
import { redirect } from "next/navigation";
import { safeRedirectPath } from "@/lib/auth/access";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const target = safeRedirectPath(next);
  if (await getCurrentUser()) redirect(target);

  return (
    <div className="card auth-card">
      <h1>Sign in</h1>
      <p className="subtitle">Outlier is invite-only for now.</p>
      {error === "link" ? <p className="form-error">That link expired or was already used. Ask for a new one, or sign in below.</p> : null}
      <LoginForm next={target} />
      <p className="stat-note" style={{ marginTop: 14, textAlign: "center" }}>
        By signing in you agree to the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </div>
  );
}
