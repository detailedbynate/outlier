import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { SetPasswordForm } from "./set-password-form";

export const dynamic = "force-dynamic";

export default async function SetPasswordPage() {
  const current = await getCurrentUser();
  if (!current) redirect("/login");

  return (
    <div className="card auth-card">
      <h1>Welcome to Outlier</h1>
      <p className="subtitle">Set a password for {current.email} so you can sign in anytime.</p>
      <SetPasswordForm />
    </div>
  );
}
