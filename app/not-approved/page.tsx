import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { signOut } from "../login/actions";

export const dynamic = "force-dynamic";

export default async function NotApprovedPage() {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  if (current.approved) redirect("/");

  const { moderation } = current;
  const suspended = moderation.status === "suspended" || moderation.status === "banned";
  const until = moderation.until ? new Date(moderation.until).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : null;

  return (
    <div className="card auth-card">
      {suspended ? (
        <>
          <h1>{moderation.status === "banned" ? "Your account has been banned" : "Your account is suspended"}</h1>
          <p className="subtitle">
            {current.email} {until ? `can't use Outlier until ${until}.` : "can no longer use Outlier."}
          </p>
          {moderation.reason ? <p className="stat-note">Reason: {moderation.reason}</p> : null}
        </>
      ) : (
        <>
          <h1>You&apos;re not approved yet</h1>
          <p className="subtitle">{current.email} doesn&apos;t have access to Outlier yet.</p>
        </>
      )}
      <form action={signOut}>
        <button type="submit">Sign out</button>
      </form>
    </div>
  );
}