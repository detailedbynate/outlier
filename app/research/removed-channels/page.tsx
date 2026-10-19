import Link from "next/link";
import { ArchiveIcon, SearchIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Paywall } from "@/components/paywall";
import { requireApprovedUser } from "@/lib/auth/session";
import { paidFeaturesLocked } from "@/lib/billing/feature-gate";
import { PAID_FEATURES } from "@/lib/billing/features";
import type { ShortsChannelFilters } from "@/lib/database/repositories/channels";
import { getServices } from "@/lib/services";
import { ChannelCard } from "../shorts-channels/channel-card";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;
const removedOn = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const MAX_LIMIT = 300;

const SORTS = [
  { key: "recent", label: "Recently removed", column: "last_synced_at" },
  { key: "subs", label: "Most subscribers", column: "subscriber_count" },
  { key: "views", label: "Average views", column: "avg_short_views" },
] as const satisfies readonly { key: string; label: string; column: ShortsChannelFilters["orderBy"] }[];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Channels YouTube deleted or terminated. Their numbers and uploads stay in
 * the library, so you can see what they were doing and who fills the gap.
 */
export default async function RemovedChannelsPage({ searchParams }: { searchParams: SearchParams }) {
  const current = await requireApprovedUser();
  if (await paidFeaturesLocked(current)) return <Paywall feature={PAID_FEATURES["removed"]} />;
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  const sort = SORTS.find((s) => s.key === params.sort) ?? SORTS[0];
  const limit = Math.min(Math.max(Number(params.limit) || PAGE_SIZE, PAGE_SIZE), MAX_LIMIT);

  const { research } = getServices();
  const { channels, terms } = await research.browseShortsChannels(
    q,
    // Removed for being reuploads still counts: the archive is about what went.
    { removed: "only", excludeLowQuality: false, orderBy: sort.column, limit },
    6,
  );
  const canLoadMore = channels.length === limit && limit < MAX_LIMIT;
  const href = (overrides: Record<string, string>) => {
    const next = new URLSearchParams({ ...(q ? { q } : {}), sort: sort.key, ...overrides });
    if (next.get("sort") === SORTS[0].key) next.delete("sort");
    return `/research/removed-channels${next.size > 0 ? `?${next}` : ""}`;
  };

  return (
    <div className="research-page">
      <PageHeader icon={ArchiveIcon} title="Removed Channels" subtitle="Channels YouTube deleted or terminated, with what they had before they went." />

      <form method="get" action="/research/removed-channels" className="removed-search">
        <SearchIcon size={16} />
        <input type="search" name="q" defaultValue={q} placeholder="Search removed channels by niche or name" aria-label="Search removed channels" />
        {sort.key !== SORTS[0].key ? <input type="hidden" name="sort" value={sort.key} /> : null}
        <button type="submit">Search</button>
      </form>

      <div className="chips chips-scroll" aria-label="Sort by">
        {SORTS.map((o) => (
          <Link key={o.key} href={href({ sort: o.key })} className="chip" aria-current={o.key === sort.key}>
            {o.label}
          </Link>
        ))}
      </div>

      <div className="results-meta">
        <span>
          {channels.length === 0 ? "No removed channels found" : `${canLoadMore ? `Latest ${channels.length}` : channels.length} removed ${channels.length === 1 ? "channel" : "channels"}`}
          {terms.length > 0 ? ` matching ${terms.map((t) => `“${t}”`).join(", ")}` : ""}
        </span>
        <span className="muted">Numbers are from the last refresh before the channel went.</span>
      </div>

      {channels.length === 0 ? (
        <div className="card empty">
          {q ? "No removed channels match that search." : "No removed channels yet. They show up here when a refresh finds the channel gone."}
        </div>
      ) : (
        <div className="channel-list">
          {channels.map((channel) => (
            <ChannelCard
              key={channel.channel_id}
              channel={channel}
              showVideos
              badge={channel.last_synced_at ? `Removed ~${removedOn(channel.last_synced_at)}` : "Removed"}
            />
          ))}
        </div>
      )}

      {canLoadMore ? (
        <div className="load-more">
          <Link href={href({ limit: String(limit + PAGE_SIZE) })} className="toolbar-button" scroll={false}>
            Show more
          </Link>
        </div>
      ) : null}
    </div>
  );
}
