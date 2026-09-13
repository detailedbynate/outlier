import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { signOut } from "../login/actions";

export const dynamic = "force-dynamic";

export default async function NotApprovedPage() {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  if (current.approved) redirect("/");

  return (
    <div className="card auth-card">
      <h1>You&apos;re not approved yet</h1>
      <p className="subtitle">{current.email} doesn&apos;t have access to Outlier yet.</p>
      <form action={signOut}>
        <button type="submit">Sign out</button>
      </form>
    </div>
  );
}
