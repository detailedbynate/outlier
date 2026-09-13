import { redirect } from "next/navigation";
import { safeRedirectPath } from "@/lib/auth/access";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const target = safeRedirectPath(next);
  if (await getCurrentUser()) redirect(target);

  return (
    <div className="card auth-card">
      <h1>Sign in</h1>
      <p className="subtitle">Outlier is invite-only for now.</p>
      <LoginForm next={target} />
    </div>
  );
}
