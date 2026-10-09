import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthSplit } from "@/components/auth-split";
import { getCurrentUser } from "@/lib/auth/session";
import { ForgotForm } from "./forgot-form";

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  if (await getCurrentUser()) redirect("/set-password");

  return (
    <AuthSplit
      foot={
        <>
          Remembered it? <Link href="/login">Sign in</Link>
        </>
      }
    >
      <h1 className="auth-title">Reset your password</h1>
      <p className="auth-sub">Enter the email you signed up with and we&apos;ll send you a link to choose a new password.</p>
      <ForgotForm />
    </AuthSplit>
  );
}
