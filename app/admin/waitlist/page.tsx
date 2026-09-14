import Link from "next/link";
import { UsersIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { requireAdmin } from "@/lib/auth/session";
import { timeAgo } from "@/lib/format";
import { getServices } from "@/lib/services";
import type { WaitlistStatus } from "@/types/database";
import { InviteControls } from "./invite-controls";

export const dynamic = "force-dynamic";

const TABS: { key: WaitlistStatus; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "invited", label: "Invited" },
  { key: "joined", label: "Joined" },
];

export default async function AdminWaitlistPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdmin();
  const { status: rawStatus } = await searchParams;
  const status = TABS.find((t) => t.key === rawStatus)?.key ?? "pending";

  const { repositories } = getServices();
  const [entries, pending, invited, joined] = await Promise.all([
    repositories.waitlist.list({ status, limit: 200 }),
    repositories.waitlist.count("pending"),
    repositories.waitlist.count("invited"),
    repositories.waitlist.count("joined"),
  ]);
  const counts: Record<string, number> = { pending, invited, joined };

  return (
    <div className="stack">
      <PageHeader icon={UsersIcon} title="Waitlist" subtitle="Invite people in batches. Oldest signups are listed first." />

      <div className="grid grid-4">
        <StatTile label="Waiting" value={pending.toLocaleString()} />
        <StatTile label="Invited" value={invited.toLocaleString()} note="Invite sent, not signed in yet" />
        <StatTile label="Joined" value={joined.toLocaleString()} />
      </div>

      <div className="chips">
        {TABS.map((tab) => (
          <Link key={tab.key} href={`/admin/waitlist?status=${tab.key}`} className="chip" aria-current={tab.key === status}>
            {tab.label} ({counts[tab.key]})
          </Link>
        ))}
      </div>

      <section className="card">
        {entries.length === 0 ? (
          <div className="empty">Nobody here yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
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
                    <td>
                      <strong>{entry.email}</strong>
                      {entry.channel_url ? (
                        <div className="stat-note">
                          <a href={normalizeUrl(entry.channel_url)} target="_blank" rel="noreferrer nofollow">
                            {entry.channel_url}
                          </a>
                        </div>
                      ) : null}
                    </td>
                    <td>{entry.niche ?? <span className="muted">—</span>}</td>
                    <td>{entry.use_case ?? <span className="muted">—</span>}</td>
                    <td className="num muted">{timeAgo(entry.created_at)}</td>
                    <td>
                      {entry.status === "joined" ? (
                        <span className="badge">Joined {timeAgo(entry.joined_at)}</span>
                      ) : (
                        <InviteControls entryId={entry.id} status={entry.status} />
                      )}
                    </td>
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

/** Only link to http(s) URLs people typed in; anything else is shown as text only. */
function normalizeUrl(value: string): string {
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "#";
  } catch {
    return "#";
  }
}
