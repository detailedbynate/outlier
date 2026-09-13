/* eslint-disable @next/next/no-img-element -- YouTube avatars are already CDN-optimized */
import Link from "next/link";
import { requireApprovedUser } from "@/lib/auth/session";
import type { ShortsChannelFilters } from "@/lib/database/repositories/channels";
import { daysAgo, formatCompact, formatPercent, timeAgo } from "@/lib/format";
import { getServices } from "@/lib/services";
import { DiscoverForm } from "./discover-form";

export const dynamic = "force-dynamic";
// Discovery ingests channels inside the server action.
export const maxDuration = 60;

type Option = { key: string; label: string };

const SUBSCRIBERS: (Option & { min?: number; max?: number })[] = [
  { key: "any", label: "Any" },
  { key: "u10k", label: "Under 10K", max: 10_000 },
  { key: "10k-100k", label: "10K–100K", min: 10_000, max: 100_000 },
  { key: "100k-1m", label: "100K–1M", min: 100_000, max: 1_000_000 },
  { key: "1m", label: "1M+", min: 1_000_000 },
];

const AVG_VIEWS: (Option & { min?: number })[] = [
  { key: "any", label: "Any" },
  { key: "10k", label: "10K+", min: 10_000 },
  { key: "100k", label: "100K+", min: 100_000 },
  { key: "1m", label: "1M+", min: 1_000_000 },
];

const CHANNEL_AGE: (Option & { days?: number })[] = [
  { key: "any", label: "Any" },
  { key: "90d", label: "Under 3 months", days: 90 },
  { key: "6m", label: "Under 6 months", days: 182 },
  { key: "1y", label: "Under 1 year", days: 365 },
];

const ACTIVITY: (Option & { days?: number })[] = [
  { key: "any", label: "Any" },
  { key: "7d", label: "Posted in last 7 days", days: 7 },
  { key: "30d", label: "Posted in last 30 days", days: 30 },
];

const SORTS: (Option & { column: ShortsChannelFilters["orderBy"] })[] = [
  { key: "views", label: "Avg Short views", column: "avg_short_views" },
  { key: "subs", label: "Subscribers", column: "subscriber_count" },
  { key: "momentum", label: "Shorts last 30 days", column: "shorts_last_30d" },
  { key: "newest", label: "Newest channels", column: "channel_created_at" },
  { key: "recent", label: "Recently active", column: "last_short_at" },
];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function pick<T extends Option>(options: T[], value: unknown): T {
  return options.find((o) => o.key === value) ?? options[0]!;
}

export default async function ShortsChannelsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireApprovedUser();
  const params = await searchParams;
  const text = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const subs = pick(SUBSCRIBERS, params.subs);
  const views = pick(AVG_VIEWS, params.views);
  const age = pick(CHANNEL_AGE, params.age);
  const activity = pick(ACTIVITY, params.active);
  const sort = pick(SORTS, params.sort);

  const { research } = getServices();
  const [channels, searchesLeft] = await Promise.all([
    research.searchShortsChannels({
      text: text || undefined,
      minSubscribers: subs.min,
      maxSubscribers: subs.max,
      minAvgViews: views.min,
      createdAfter: age.days ? daysAgo(age.days) : undefined,
      activeSince: activity.days ? daysAgo(activity.days) : undefined,
      orderBy: sort.column,
      limit: 100,
    }),
    research.discoverySearchesLeftToday(),
  ]);

  const current = { q: text, subs: subs.key, views: views.key, age: age.key, active: activity.key, sort: sort.key };
  const href = (overrides: Partial<typeof current>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...current, ...overrides })) {
      if (value && value !== "any" && !(key === "sort" && value === "views")) next.set(key, value);
    }
    const qs = next.toString();
    return `/research/shorts-channels${qs ? `?${qs}` : ""}`;
  };

  const chips = (label: string, options: Option[], selected: string, param: keyof typeof current) => (
    <div className="filter-row">
      <span className="filter-label">{label}</span>
      <div className="chips">
        {options.map((o) => (
          <Link key={o.key} href={href({ [param]: o.key })} className="chip" aria-current={o.key === selected}>
            {o.label}
          </Link>
        ))}
      </div>
    </div>
  );

  return (
    <div className="stack">
      <div>
        <h1>Shorts Channels</h1>
        <p className="subtitle">Find channels that mainly post Shorts, and see how many views their Shorts typically get.</p>
      </div>

      <section className="card">
        <h2>Discover new channels</h2>
        <p className="stat-note" style={{ margin: "-6px 0 12px" }}>
          Pulls channels behind the most-viewed Shorts for a niche from the last 90 days.
        </p>
        <DiscoverForm searchesLeft={searchesLeft} />
      </section>

      <section className="card filter-bar">
        <form method="get" className="form" action="/research/shorts-channels">
          {Object.entries(current).map(([key, value]) =>
            key === "q" || value === "any" ? null : <input key={key} type="hidden" name={key} value={value} />,
          )}
          <label htmlFor="q" className="sr-only">
            Search by channel name
          </label>
          <input id="q" name="q" type="text" defaultValue={text} placeholder="Search saved Shorts channels by name" />
          <button type="submit">Search</button>
        </form>
        {chips("Subscribers", SUBSCRIBERS, subs.key, "subs")}
        {chips("Avg views", AVG_VIEWS, views.key, "views")}
        {chips("Channel age", CHANNEL_AGE, age.key, "age")}
        {chips("Activity", ACTIVITY, activity.key, "active")}
        {chips("Sort by", SORTS, sort.key, "sort")}
      </section>

      <section className="card">
        <div className="spread" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>
            {channels.length === 100 ? "Top 100" : channels.length} {channels.length === 1 ? "channel" : "channels"}
          </h2>
          <span className="stat-note">Stats from each channel&apos;s latest uploads</span>
        </div>
        {channels.length === 0 ? (
          <div className="empty">
            No Shorts channels match. Try a different filter, or discover a niche above.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Channel</th>
                  <th className="num">Subscribers</th>
                  <th className="num">Avg Short views</th>
                  <th className="num">Median</th>
                  <th className="num">Top Short</th>
                  <th className="num">Shorts / 30d</th>
                  <th className="num">Shorts share</th>
                  <th className="num">Channel age</th>
                  <th className="num">Last Short</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((c) => (
                  <tr key={c.channel_id}>
                    <td>
                      <Link href={`/channels/${c.youtube_channel_id}`} className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
                        {c.thumbnail_url ? <img className="avatar" src={c.thumbnail_url} alt="" loading="lazy" /> : null}
                        <span style={{ minWidth: 0 }}>
                          <strong className="clamp">{c.title}</strong>
                          <span className="muted" style={{ fontSize: 12 }}>
                            {c.handle ?? ""}
                            {c.country ? ` · ${c.country}` : ""}
                            {c.tracked ? " · Tracked" : ""}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="num">{c.hidden_subscriber_count ? "Hidden" : formatCompact(c.subscriber_count)}</td>
                    <td className="num">
                      <strong>{formatCompact(c.avg_short_views)}</strong>
                    </td>
                    <td className="num">{formatCompact(c.median_short_views)}</td>
                    <td className="num">{formatCompact(c.top_short_views)}</td>
                    <td className="num">{c.shorts_last_30d}</td>
                    <td className="num">{formatPercent(c.shorts_share, 0)}</td>
                    <td className="num muted">{c.channel_created_at ? timeAgo(c.channel_created_at).replace(" ago", "") : "—"}</td>
                    <td className="num muted">{timeAgo(c.last_short_at)}</td>
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
