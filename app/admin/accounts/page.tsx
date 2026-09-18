import type { Metadata } from "next";
import Link from "next/link";
import { BulkPanel, type BulkOption } from "@/components/bulk-panel";
import { UsersIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { requireAdmin } from "@/lib/auth/session";
import { env } from "@/lib/core/env";
import { formatNumber, timeAgo } from "@/lib/format";
import { DURATIONS, moderationState, type AccountStatus } from "@/lib/moderation/status";
import { getServices } from "@/lib/services";
import type { AccountRole } from "@/types/database";
import { AdjustCreditsForm, CreateAccountForm, EditAccountForm } from "./account-forms";
import { moderateAccounts } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Accounts · Outlier" };

const ROLE_LABEL: Record<AccountRole, string> = { owner: "Owner", admin: "Admin", member: "Member" };
const STATUS_LABEL: Record<AccountStatus, string> = { active: "Active", restricted: "Restricted", suspended: "Suspended", banned: "Banned" };

const TABS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "restricted", label: "Restricted" },
  { key: "banned", label: "Banned & suspended" },
  { key: "admins", label: "Admins" },
] as const;

const TEMP_DURATIONS = DURATIONS.filter((d) => d.hours > 0);

const BULK_OPTIONS: BulkOption[] = [
  { value: "restrict", label: "Restrict (no credits or data)", fields: ["duration", "reason"], durations: DURATIONS },
  { value: "unrestrict", label: "Lift restriction" },
  { value: "temp_ban", label: "Suspend (temporary ban)", fields: ["duration", "reason"], durations: TEMP_DURATIONS },
  { value: "ban", label: "Ban permanently", fields: ["reason"], destructive: true },
  { value: "unban", label: "Unban / lift suspension" },
  { value: "set_limits", label: "Set limits", fields: ["limits"] },
  { value: "remove", label: "Remove account (delete)", fields: ["reason"], destructive: true },
];

const ACTION_LABEL: Record<string, string> = {
  ban: "Banned",
  temp_ban: "Suspended",
  unban: "Unbanned",
  restrict: "Restricted",
  unrestrict: "Lifted restriction",
  remove: "Removed account",
  set_limits: "Changed limits",
  waitlist_remove: "Removed from waitlist",
  waitlist_decline: "Declined waitlist entry",
};

type SearchParams = Promise<{ tab?: string; q?: string }>;

export default async function AccountsPage({ searchParams }: { searchParams: SearchParams }) {
  const current = await requireAdmin();
  const params = await searchParams;
  const tab = TABS.find((t) => t.key === params.tab)?.key ?? "all";
  const q = (params.q ?? "").trim().toLowerCase().slice(0, 100);

  const services = getServices();
  const config = env();
  const [users, log, quota] = await Promise.all([
    services.moderation.listUsers(),
    services.moderation.recentActions(30).catch(() => []),
    services.quota.summary().catch(() => null),
  ]);

  const now = new Date();
  const rows = users.map((u) => {
    const role: AccountRole = services.accounts.isOwnerEmail(u.email) ? "owner" : (u.settings?.role ?? "member");
    return { ...u, role, state: role === "owner" ? moderationState(null, now) : moderationState(u.settings, now) };
  });
  const counts = {
    all: rows.length,
    active: rows.filter((r) => r.state.status === "active").length,
    restricted: rows.filter((r) => r.state.status === "restricted").length,
    banned: rows.filter((r) => r.state.status === "banned" || r.state.status === "suspended").length,
    admins: rows.filter((r) => r.role !== "member").length,
  };
  const visible = rows.filter((r) => {
    if (q && !r.email.toLowerCase().includes(q) && !(r.settings?.note ?? "").toLowerCase().includes(q)) return false;
    if (tab === "active") return r.state.status === "active";
    if (tab === "restricted") return r.state.status === "restricted";
    if (tab === "banned") return r.state.status === "banned" || r.state.status === "suspended";
    if (tab === "admins") return r.role !== "member";
    return true;
  });
  const usage = await Promise.all(visible.map((r) => (r.role === "owner" ? null : services.credits.status(r.id).catch(() => null))));
  const emailById = new Map(users.map((u) => [u.id, u.email]));

  return (
    <div className="stack">
      <PageHeader icon={UsersIcon} title="Accounts" subtitle="Create accounts, set limits, and moderate: restrict, suspend, ban, or remove." />

      <div className="grid grid-4">
        <StatTile label="Accounts" value={counts.all.toLocaleString()} note={`${counts.admins} admin${counts.admins === 1 ? "" : "s"}`} />
        <StatTile label="Restricted" value={counts.restricted.toLocaleString()} />
        <StatTile label="Banned & suspended" value={counts.banned.toLocaleString()} />
        <StatTile
          label="YouTube units today"
          value={quota ? formatNumber(quota.used.total) : "—"}
          note={quota ? `of ${formatNumber(quota.limits.daily)} · users ${formatNumber(quota.used.user)}` : undefined}
        />
      </div>

      <section className="card">
        <h2>Create an account</h2>
        <p className="stat-note">
          Leave limits blank to use the defaults. &ldquo;Copy sign-in link&rdquo; works without email setup.
        </p>
        <CreateAccountForm canCreateAdmins={current.isOwner} defaultCredits={config.MONTHLY_CREDITS} defaultUnits={config.YOUTUBE_USER_DAILY_UNITS} />
      </section>

      <section className="card stack">
        <div className="admin-filters">
          <div className="chips">
            {TABS.map((t) => (
              <Link key={t.key} href={`/admin/accounts?tab=${t.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className="chip" aria-current={t.key === tab}>
                {t.label} ({counts[t.key]})
              </Link>
            ))}
          </div>
          <form method="get" action="/admin/accounts">
            <input type="hidden" name="tab" value={tab} />
            <input type="search" name="q" defaultValue={q} placeholder="Search email or note" aria-label="Search accounts" />
            <button type="submit" className="button-ghost">
              Search
            </button>
          </form>
        </div>

        <BulkPanel formId="accounts-bulk" action={moderateAccounts} options={BULK_OPTIONS} noun="account">
          {visible.length === 0 ? (
            <div className="empty">No accounts match.</div>
          ) : (
            <div className="table-wrap">
              <table className="accounts-table">
                <thead>
                  <tr>
                    <th className="row-check">
                      <span className="sr-only">Select</span>
                    </th>
                    <th>Account</th>
                    <th>Status</th>
                    <th className="num">Credits this month</th>
                    <th>Role · credits/month · YouTube units/day · note</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row, i) => {
                    const status = usage[i];
                    const protectedRow = row.role === "owner" || row.id === current.user.id || (row.role === "admin" && !current.isOwner);
                    return (
                      <tr key={row.id} className={row.state.status === "banned" || row.state.status === "suspended" ? "is-disabled" : undefined}>
                        <td className="row-check">
                          {protectedRow ? null : <input type="checkbox" name="ids" value={row.id} form="accounts-bulk" aria-label={`Select ${row.email}`} />}
                        </td>
                        <td>
                          <strong>{row.email}</strong>
                          <div className="stat-note">
                            <span className={`badge role-${row.role}`}>{ROLE_LABEL[row.role]}</span> · joined {timeAgo(row.created_at)}
                          </div>
                        </td>
                        <td>
                          <span className="status-badge" data-status={row.state.status} title={row.state.reason ?? undefined}>
                            {STATUS_LABEL[row.state.status]}
                          </span>
                          {row.state.until ? <div className="stat-note">until {new Date(row.state.until).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</div> : null}
                          {row.state.reason ? <div className="stat-note">“{row.state.reason}”</div> : null}
                        </td>
                        <td className="num">
                          {row.role === "owner" ? "Unlimited" : status ? `${formatNumber(status.used)} / ${formatNumber(status.monthly)}` : "—"}
                          {status && status.extra > 0 ? <div className="stat-note">+{formatNumber(status.extra)} extra</div> : null}
                          {current.isOwner && row.role !== "owner" ? <AdjustCreditsForm userId={row.id} extra={status?.extra ?? 0} /> : null}
                        </td>
                        <td>
                          <EditAccountForm
                            account={{
                              user_id: row.id,
                              role: row.role,
                              daily_credits: row.settings?.daily_credits ?? null,
                              youtube_daily_units: row.settings?.youtube_daily_units ?? null,
                              note: row.settings?.note ?? null,
                              disabled: false,
                            }}
                            canEditRole={current.isOwner}
                            locked={row.role === "owner" ? !current.isOwner : row.role === "admin" && !current.isOwner}
                            hasSettings={row.settings !== null}
                            email={row.email}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </BulkPanel>
      </section>

      <section className="card">
        <h2>Moderation log</h2>
        {log.length === 0 ? (
          <div className="empty">No moderation actions yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="mod-log">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Account</th>
                  <th>Details</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {log.map((entry) => (
                  <tr key={entry.id}>
                    <td className="muted">{timeAgo(entry.created_at)}</td>
                    <td>{ACTION_LABEL[entry.action] ?? entry.action}</td>
                    <td>{entry.target_email}</td>
                    <td className="muted">
                      {entry.until && Date.parse(entry.until) < Date.parse("9000-01-01") ? `until ${new Date(entry.until).toLocaleDateString("en-US", { dateStyle: "medium" })}` : ""}
                      {entry.reason ? ` “${entry.reason}”` : ""}
                    </td>
                    <td className="muted">{(entry.actor_id && emailById.get(entry.actor_id)) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
