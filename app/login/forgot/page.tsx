import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { ForgotForm } from "./forgot-form";

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  if (await getCurrentUser()) redirect("/set-password");

  return (
    <div className="card auth-card">
      <h1>Reset your password</h1>
      <p className="subtitle">Enter the email you signed up with and we&apos;ll send you a link to choose a new password.</p>
      <ForgotForm />
      <p className="stat-note" style={{ marginTop: 14, textAlign: "center" }}>
        <Link href="/login">Back to sign in</Link>
      </p>
    </div>
  );
}
