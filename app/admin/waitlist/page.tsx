import Link from "next/link";
import { BulkPanel, type BulkOption } from "@/components/bulk-panel";
import { UsersIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { requireAdmin } from "@/lib/auth/session";
import { timeAgo } from "@/lib/format";
import { getServices } from "@/lib/services";
import type { WaitlistStatus } from "@/types/database";
import { bulkWaitlist } from "./actions";
import { InviteControls } from "./invite-controls";

export const dynamic = "force-dynamic";

const TABS: { key: WaitlistStatus; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "invited", label: "Invited" },
  { key: "joined", label: "Joined" },
  { key: "declined", label: "Declined" },
];

const BULK_OPTIONS: BulkOption[] = [
  { value: "invite", label: "Send invite emails" },
  { value: "decline", label: "Decline" },
  { value: "restore", label: "Move back to pending" },
  { value: "remove", label: "Remove from waitlist", destructive: true },
];

export default async function AdminWaitlistPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  await requireAdmin();
  const { status: rawStatus, q: rawQuery } = await searchParams;
  const status = TABS.find((t) => t.key === rawStatus)?.key ?? "pending";
  const q = (rawQuery ?? "").trim().slice(0, 100);

  const { repositories } = getServices();
  const [entries, pending, invited, joined, declined] = await Promise.all([
    repositories.waitlist.list({ status, limit: 500, search: q || undefined }),
    repositories.waitlist.count("pending"),
    repositories.waitlist.count("invited"),
    repositories.waitlist.count("joined"),
    repositories.waitlist.count("declined"),
  ]);
  const counts: Record<string, number> = { pending, invited, joined, declined };

  return (
    <div className="stack">
      <PageHeader
        icon={UsersIcon}
        title="Waitlist"
        subtitle="Invite people in batches. Oldest signups are listed first."
      />

      <div className="grid grid-4">
        <StatTile label="Waiting" value={pending.toLocaleString()} />
        <StatTile
          label="Invited"
          value={invited.toLocaleString()}
          note="Invite sent, not signed in yet"
        />
        <StatTile label="Joined" value={joined.toLocaleString()} />
        <StatTile label="Declined" value={declined.toLocaleString()} />
      </div>

      <div className="admin-filters">
        <div className="chips">
          {TABS.map((tab) => (
            <Link
              key={tab.key}
              href={`/admin/waitlist?status=${tab.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className="chip"
              aria-current={tab.key === status}
            >
              {tab.label} ({counts[tab.key]})
            </Link>
          ))}
        </div>
        <form method="get" action="/admin/waitlist">
          <input type="hidden" name="status" value={status} />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search email, name, or niche"
            aria-label="Search waitlist"
          />
          <button type="submit" className="button-ghost">
            Search
          </button>
        </form>
        <a
          href={`/admin/waitlist/export?status=${status}`}
          className="button-ghost"
        >
          Export CSV
        </a>
      </div>

      <section className="card">
        <BulkPanel
          formId="waitlist-bulk"
          action={bulkWaitlist}
          options={BULK_OPTIONS}
          noun="person"
        >
          {entries.length === 0 ? (
            <div className="empty">
              {q ? "No matches." : "Nobody here yet."}
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="row-check">
                      <span className="sr-only">Select</span>
                    </th>
                    <th>Person</th>
                    <th>Niche</th>
                    <th>Wants to</th>
                    <th className="num">Signed up</th>
                    <th>Invite</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="row-check">
                        <input
                          type="checkbox"
                          name="ids"
                          value={entry.id}
                          form="waitlist-bulk"
                          aria-label={`Select ${entry.email}`}
                        />
                      </td>
                      <td>
                        <strong>{entry.email}</strong>
                        {entry.channel_url ? (
                          <div className="stat-note">
                            <a
                              href={normalizeUrl(entry.channel_url)}
                              target="_blank"
                              rel="noreferrer nofollow"
                            >
                              {entry.channel_url}
                            </a>
                          </div>
                        ) : null}
                      </td>
                      <td>{entry.niche ?? <span className="muted">—</span>}</td>
                      <td>
                        {entry.use_case ?? <span className="muted">—</span>}
                      </td>
                      <td className="num muted">{timeAgo(entry.created_at)}</td>
                      <td>
                        {entry.status === "joined" ? (
                          <span className="badge">
                            Joined {timeAgo(entry.joined_at)}
                          </span>
                        ) : entry.status === "declined" ? (
                          <span className="badge">Declined</span>
                        ) : (
                          <InviteControls
                            entryId={entry.id}
                            status={entry.status}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </BulkPanel>
      </section>
    </div>
  );
}

/** Only link to http(s) URLs people typed in; anything else is shown as text only. */
function normalizeUrl(value: string): string {
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : "#";
  } catch {
    return "#";
  }
}
