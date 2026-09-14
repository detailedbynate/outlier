import type { Metadata } from "next";
import { UsersIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { requireAdmin } from "@/lib/auth/session";
import { env } from "@/lib/core/env";
import { formatNumber, timeAgo } from "@/lib/format";
import { getServices } from "@/lib/services";
import { CreateAccountForm, EditAccountForm } from "./account-forms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Accounts · Outlier" };

const ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "Member" } as const;

export default async function AccountsPage() {
  const current = await requireAdmin();
  const services = getServices();
  const config = env();
  const accounts = await services.accounts.list();
  const [usage, quota] = await Promise.all([
    Promise.all(accounts.map((a) => services.credits.status(a.user_id).catch(() => null))),
    services.quota.summary().catch(() => null),
  ]);

  return (
    <div className="stack">
      <PageHeader icon={UsersIcon} title="Accounts" subtitle="Create accounts and set each person's role, daily credits, and YouTube data limit." />

      <div className="grid grid-4">
        <StatTile label="Accounts" value={accounts.length.toLocaleString()} />
        <StatTile label="Admins" value={accounts.filter((a) => a.role !== "member").length.toLocaleString()} />
        <StatTile
          label="YouTube units today"
          value={quota ? formatNumber(quota.used.total) : "—"}
          note={quota ? `of ${formatNumber(quota.limits.daily)} · users ${formatNumber(quota.used.user)} · background ${formatNumber(quota.used.background)}` : undefined}
        />
        <StatTile label="You are" value={current.isOwner ? "Owner" : "Admin"} />
      </div>

      <section className="card">
        <h2>Create an account</h2>
        <p className="stat-note">
          Leave limits blank to use the defaults. &ldquo;Copy sign-in link&rdquo; works without email setup; &ldquo;Send invite email&rdquo; needs SMTP
          configured in Supabase.
        </p>
        <CreateAccountForm canCreateAdmins={current.isOwner} defaultCredits={config.DAILY_CREDITS} defaultUnits={config.YOUTUBE_USER_DAILY_UNITS} />
      </section>

      <section className="card">
        {accounts.length === 0 ? (
          <div className="empty">No accounts yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="accounts-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="num">Credits today</th>
                  <th>Role · credits/day · YouTube units/day · note</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account, i) => {
                  const status = usage[i];
                  const locked = account.role === "owner" ? !current.isOwner : account.role === "admin" && !current.isOwner;
                  return (
                    <tr key={account.user_id} className={account.disabled ? "is-disabled" : undefined}>
                      <td>
                        <strong>{account.email}</strong>
                        <div className="stat-note">
                          <span className={`badge role-${account.role}`}>{ROLE_LABEL[account.role]}</span>
                          {account.disabled ? <span className="badge"> Disabled</span> : null} · added {timeAgo(account.created_at)}
                        </div>
                      </td>
                      <td className="num">
                        {account.role === "owner" ? "Unlimited" : status ? `${formatNumber(status.used)} / ${formatNumber(status.limit)}` : "—"}
                      </td>
                      <td>
                        <EditAccountForm account={account} canEditRole={current.isOwner} locked={locked} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}