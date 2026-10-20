import Link from "next/link";
import { ArchiveIcon, PenIcon, SearchIcon } from "@/components/icons";
import { formatCompact, formatMultiplier } from "@/lib/format";
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
const IDEAS = 24;
const IDEAS_PER_CHANNEL = 3;
/** Hashtags are for YouTube search, not the idea. */
const withoutHashtags = (title: string) => title.replace(/#[\p{L}\p{N}_]+/gu, "").replace(/\s+/g, " ").trim() || title;

const SORTS = [
  { key: "recent", label: "Recently removed", column: "last_synced_at" },
  { key: "subs", label: "Most subscribers", column: "subscriber_count" },
  { key: "views", label: "Average views", column: "avg_short_views" },
] as const satisfies readonly { key: string; label: string; column: ShortsChannelFilters["orderBy"] }[];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Channels YouTube deleted or terminated. Their videos can't be watched any
 * more, but the titles and numbers stay in the library: the page leads with
 * their best videos as proven ideas nobody is making now, each one a click
 * from a script, then the channels themselves.
 */
export default async function RemovedChannelsPage({ searchParams }: { searchParams: SearchParams }) {
  const current = await requireApprovedUser();
  if (await paidFeaturesLocked(current)) return <Paywall feature={PAID_FEATURES["removed"]} />;
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  const sort = SORTS.find((s) => s.key === params.sort) ?? SORTS[0];
  const limit = Math.min(Math.max(Number(params.limit) || PAGE_SIZE, PAGE_SIZE), MAX_LIMIT);

  const { research, repositories } = getServices();
  // Removed for being reuploads still counts: the archive is about what went.
  const removedOnly = { removed: "only", excludeLowQuality: false } as const;
  const [{ channels, terms }, everyRemoved] = await Promise.all([
    // No Short previews: the videos are gone and their thumbnails don't load.
    research.browseShortsChannels(q, { ...removedOnly, orderBy: sort.column, limit }, 0),
    research.browseShortsChannels(q, { ...removedOnly, orderBy: "subscriber_count", limit: MAX_LIMIT }, 0),
  ]);
  const byChannel = new Map(everyRemoved.channels.map((c) => [c.channel_id, c]));
  const topVideos = byChannel.size === 0 ? [] : await repositories.videos.feed({ channelIds: [...byChannel.keys()], orderBy: "view_count", limit: IDEAS * 5 });
  // A few per channel, and one of each idea ("Buzz Vs Sonic Vs Mario" and "Sonic Vs Mario Vs Buzz" are the same video).
  const perChannel = new Map<string, number>();
  const seen = new Set<string>();
  const ideas = topVideos
    .filter((video) => {
      const key = [...new Set(withoutHashtags(video.title).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].sort().join(" ");
      const n = perChannel.get(video.channel_id) ?? 0;
      if (seen.has(key) || n >= IDEAS_PER_CHANNEL) return false;
      seen.add(key);
      perChannel.set(video.channel_id, n + 1);
      return true;
    })
    .slice(0, IDEAS);
  const writeHref = (title: string, channelId: string) => {
    const channel = byChannel.get(channelId);
    const topic = channel?.niche_labels?.[0] ?? channel?.niche_category ?? "";
    return `/research/scriptwriter?${new URLSearchParams({ idea: withoutHashtags(title), ...(topic ? { topic } : {}) })}`;
  };
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

      {ideas.length > 0 ? (
        <section className="card proven-ideas">
          <div className="proven-head">
            <h2>Proven ideas, no competition</h2>
            <p className="muted">Their biggest videos. The idea already pulled the views, and the channel that made it is gone.</p>
          </div>
          <ol className="proven-list">
            {ideas.map((video) => (
              <li key={video.video_id}>
                <div className="proven-text">
                  <strong>{video.title}</strong>
                  <span className="muted">
                    {video.channel_title} · {video.format === "short" ? "Short" : "Video"} · {formatCompact(video.view_count)} views
                    {(video.outlier_score ?? 0) >= 1.5 ? ` · ${formatMultiplier(video.outlier_score)} their usual` : ""}
                  </span>
                </div>
                <Link href={writeHref(video.title, video.channel_id)} className="button-ghost button-small proven-write">
                  <PenIcon size={13} /> Write my version
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

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
              showVideos={false}
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
