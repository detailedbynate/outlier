/* eslint-disable @next/next/no-img-element -- YouTube images are already CDN-optimized */
import Link from "next/link";
import { Dropdown } from "@/components/dropdown";
import { ChevronDownIcon, FlameIcon, ShortsIcon, SlidersIcon, SortIcon, VideoIcon, VideoOffIcon, ZapIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { requireApprovedUser } from "@/lib/auth/session";
import { env } from "@/lib/core/env";
import { timeAgo } from "@/lib/format";
import { qualityConfigFrom } from "@/lib/research/quality";
import { getServices } from "@/lib/services";
import { CREDIT_COSTS } from "@/lib/services/credits-service";
import { looksLikeChannelReference } from "@/lib/services/research-service";
import { VideoCard } from "@/components/video-card";
import { writerAccess } from "@/lib/scripts/access";
import { AddChannel } from "./add-channel";
import { PeerPlan } from "./peer-plan";
import { clearTrendingPicks, repickTrending } from "./actions";
import { ChannelCard } from "./channel-card";
import { TrendingCard } from "./trending-card";
import { SearchHero } from "./search-hero";
import {
  ACTIVITY,
  AVG_VIEWS,
  activeQuickFilter,
  buildHref,
  CHANNEL_AGE,
  clearedAdvanced,
  DEFAULT_SORT,
  countAdvanced,
  isRealtimeSort,
  COUNTRIES,
  FACE,
  label,
  MARKETS,
  MAX_LIMIT,
  PAGE_SIZE,
  parseState,
  QUICK_FILTERS,
  SHORTS_SHARE,
  SORT_GROUPS,
  SORTS,
  SUBSCRIBERS,
  toFilters,
} from "./filters";

export const dynamic = "force-dynamic";
// Discovery ingests channels inside the server action.
export const maxDuration = 60;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ShortsChannelsPage({ searchParams }: { searchParams: SearchParams }) {
  const current = await requireApprovedUser();
  const { isAdmin, user } = current;
  const state = parseState(await searchParams);
  const showVideos = state.videos !== "hide";

  const advancedCount = countAdvanced(state);
  const quick = activeQuickFilter(state);
  // Trending picks show on the default view, before the user searches or filters.
  const isDefaultView = !state.q && !state.similar && advancedCount === 0 && !quick;

  const { research, trending, repositories, similar } = getServices();
  const targetCountries = qualityConfigFrom(env()).countries;
  const filters = toFilters(state, targetCountries, user.id);
  // "Channels like X": picked from a card (?similar=id), or a pasted @handle or channel link.
  const reference = !state.similar && looksLikeChannelReference(state.q) ? state.q.trim() : null;
  const similarMode = Boolean(state.similar || reference) && similar.enabled;
  const target = !similarMode
    ? null
    : state.similar
      ? await repositories.channels.findById(state.similar)
      : await research.findChannelByReference(reference!);
  const [{ channels, terms }, popular, searchesLeft, picks, breakouts, canPlan] = await Promise.all([
    similarMode
      ? target
        ? research.similarShortsChannels(target.id, filters, showVideos ? 8 : 0).then((rows) => ({ channels: rows, terms: [] as string[] }))
        : Promise.resolve({ channels: [], terms: [] as string[] })
      : research.browseShortsChannels(state.q, filters, showVideos ? 8 : 0),
    research.popularKeywords(10),
    research.discoverySearchesLeftToday(),
    isDefaultView ? trending.currentPicks() : Promise.resolve([]),
    target && similarMode ? research.peerBreakouts(target.id, 8) : Promise.resolve([]),
    target && similarMode ? writerAccess(current).then(Boolean) : Promise.resolve(false),
  ]);
  // Tracking is per-user, so the bookmark state comes from this user's follows
  // rather than the shared flag on the row.
  const followed = await repositories.channels.followedIds(user.id, channels.map((c) => c.channel_id));
  const picksUpdatedAt = picks.map((p) => p.stats_updated_at ?? p.created_at).sort().at(-1);
  const canLoadMore = channels.length === Number(state.limit) && Number(state.limit) < MAX_LIMIT;
  // Filters ride along with the search so typing a new query keeps them.
  const hiddenFilters = Object.entries(state)
    .filter(
      ([key, value]) =>
        !(
          key === "q" ||
          key === "limit" ||
          key === "similar" ||
          (value === "any" && key !== "market") ||
          (key === "market" && value === "en") ||
          (key === "sort" && value === DEFAULT_SORT) ||
          (key === "videos" && value === "show")
        ),
    )
    .map(([name, value]) => ({ name, value }));

  const select = (name: string, options: { key: string; label: string }[], value: string) => (
    <label className="field">
      <span>{
        { subs: "Subscribers", views: "Average views", age: "Channel age", active: "Last upload", share: "Shorts share", face: "Creator on camera", country: "Country", market: "Language" }[name]
      }</span>
      <select name={name} defaultValue={value}>
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="research-page">
      <PageHeader icon={ShortsIcon} title="Shorts Channels" subtitle="Find channels winning with Shorts, by niche, size, and momentum." />
      <SearchHero query={state.q} hidden={hiddenFilters} searchesLeft={searchesLeft} channelSearch={similarMode} />

      <div className="popular-row">
        <span className="muted">Popular this week:</span>
        {popular.map((keyword) => (
          <Link key={keyword} href={buildHref(state, { q: keyword, limit: String(PAGE_SIZE) })} className="keyword-chip">
            {keyword}
          </Link>
        ))}
      </div>

      <div className="toolbar">
        <div className="toolbar-group">
          <Dropdown
            label={
              <>
                <span>{quick ? quick.label : "Quick Filters"}</span>
                <ChevronDownIcon size={16} />
              </>
            }
          >
            {QUICK_FILTERS.map((preset) => (
              <Link
                key={preset.key}
                href={buildHref(state, { ...clearedAdvanced(), sort: DEFAULT_SORT, ...preset.params, limit: String(PAGE_SIZE) })}
                className="dropdown-item"
                aria-current={quick?.key === preset.key}
              >
                <span>{preset.label}</span>
                <span className="dropdown-item-note">{preset.description}</span>
              </Link>
            ))}
            {quick ? (
              <Link href={buildHref(state, { ...clearedAdvanced(), sort: DEFAULT_SORT })} className="dropdown-item dropdown-item-muted">
                Clear quick filter
              </Link>
            ) : null}
          </Dropdown>

          <Dropdown
            label={
              <>
                <SortIcon size={15} />
                <span>
                  Sorted by: <strong>{label(SORTS, state.sort)}</strong>
                </span>
                <ChevronDownIcon size={16} />
              </>
            }
          >
            {SORT_GROUPS.map((group) => (
              <div key={group.key} className="dropdown-group">
                <div className="dropdown-group-title">
                  {group.key === "Realtime" ? <ZapIcon size={12} /> : group.key === "Signals" ? <FlameIcon size={12} /> : null}
                  {group.label}
                </div>
                {SORTS.filter((sort) => sort.group === group.key).map((sort) => (
                  <Link key={sort.key} href={buildHref(state, { sort: sort.key })} className="dropdown-item" aria-current={sort.key === state.sort}>
                    {sort.label}
                  </Link>
                ))}
              </div>
            ))}
          </Dropdown>
        </div>

        <div className="toolbar-group">
          <Dropdown
            align="end"
            label={
              <>
                <SlidersIcon size={15} />
                <span>Advanced Filters</span>
                {advancedCount > 0 ? <span className="count-badge">{advancedCount}</span> : null}
              </>
            }
          >
            <form method="get" action="/research/shorts-channels" className="advanced-form">
              {state.q ? <input type="hidden" name="q" value={state.q} /> : null}
              {state.similar ? <input type="hidden" name="similar" value={state.similar} /> : null}
              {state.sort !== DEFAULT_SORT ? <input type="hidden" name="sort" value={state.sort} /> : null}
              {state.videos === "hide" ? <input type="hidden" name="videos" value="hide" /> : null}
              {select("subs", SUBSCRIBERS, state.subs)}
              {select("views", AVG_VIEWS, state.views)}
              {select("age", CHANNEL_AGE, state.age)}
              {select("active", ACTIVITY, state.active)}
              {select("share", SHORTS_SHARE, state.share)}
              {select("face", FACE, state.face)}
              {select("country", COUNTRIES, state.country)}
              {select("market", MARKETS, state.market)}
              <label className="checkbox-field">
                <input type="checkbox" name="tracked" value="yes" defaultChecked={state.tracked === "yes"} />
                <span>Only my tracked channels</span>
              </label>
              <div className="advanced-actions">
                <Link href={buildHref(state, clearedAdvanced())} className="button-ghost">
                  Reset
                </Link>
                <button type="submit">Apply filters</button>
              </div>
            </form>
          </Dropdown>

          <Link href={buildHref(state, { videos: showVideos ? "hide" : "show" })} className="toolbar-button">
            {showVideos ? <VideoOffIcon size={15} /> : <VideoIcon size={15} />}
            <span>{showVideos ? "Hide Videos" : "Show Videos"}</span>
          </Link>
        </div>
      </div>

      {isDefaultView && (picks.length > 0 || isAdmin) ? (
        <section className="trending-section" aria-labelledby="trending-title">
          <div className="section-head">
            <span className="section-icon">
              <FlameIcon size={16} />
            </span>
            <div>
              <h2 id="trending-title">Trending today</h2>
              <p className="stat-note">
                {picks.length > 0
                  ? `Shorts beating their channel's usual views, from smaller channels across ${picks.length} niches`
                  : "No picks right now"}
                {picksUpdatedAt ? ` · updated ${timeAgo(picksUpdatedAt)}` : ""}
              </p>
            </div>
            {isAdmin ? (
              <div className="section-head-actions">
                <form action={repickTrending}>
                  <button type="submit" className="button-ghost button-small" title="Search YouTube for fresh picks (~600 quota units)">
                    Re-pick now
                  </button>
                </form>
                {picks.length > 0 ? (
                  <form action={clearTrendingPicks}>
                    <button type="submit" className="button-ghost button-small">
                      Clear picks
                    </button>
                  </form>
                ) : null}
              </div>
            ) : null}
          </div>
          {picks.length > 0 ? (
            <div className="trend-grid">
              {picks.map((pick) => (
                <TrendingCard key={pick.id} pick={pick} isAdmin={isAdmin} />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {isDefaultView && picks.length > 0 ? <h2 className="section-title">All Shorts channels</h2> : null}

      {similarMode && target ? (
        <div className="card similar-target">
          {target.thumbnail_url ? <img className="avatar" src={target.thumbnail_url} alt="" width={40} height={40} /> : null}
          <div>
            <span className="stat-note">Channels like</span>
            <Link href={`/channels/${target.youtube_channel_id}`} className="similar-target-name">
              {target.title}
            </Link>
          </div>
          <span className="muted similar-target-note">Matched on what they post: upload titles, topics and niche. Filters narrow the list.</span>
        </div>
      ) : null}
      {similarMode && target && breakouts.length > 0 ? (
        <section className="peer-section" aria-labelledby="peer-title">
          <div className="section-head">
            <span className="section-icon">
              <FlameIcon size={16} />
            </span>
            <div>
              <h2 id="peer-title">Working for channels like this</h2>
              <p className="stat-note">Shorts from the last 30 days beating their channel&apos;s usual views</p>
            </div>
          </div>
          <div className="video-grid">
            {breakouts.map((video) => (
              <VideoCard key={video.video_id} video={video} />
            ))}
          </div>
          {breakouts.length >= 3 ? <PeerPlan channelId={target.id} cost={CREDIT_COSTS.peer_ideas} available={canPlan} /> : null}
        </section>
      ) : null}
      {similarMode && reference && !target ? <AddChannel reference={reference} cost={CREDIT_COSTS.add_channel} /> : null}

      <div className="results-meta">
        <span>
          {channels.length === 0
            ? "No channels found"
            : `${canLoadMore ? `Top ${channels.length}` : channels.length} ${similarMode ? "similar " : ""}${channels.length === 1 ? "channel" : "channels"}`}
          {terms.length > 0 ? ` matching ${terms.map((t) => `“${t}”`).join(", ")}` : ""}
        </span>
        {isRealtimeSort(state.sort) ? <span className="muted">Growth since the snapshot ~24h/48h earlier · channels without history yet are listed last</span> : null}
        {advancedCount > 0 || state.q || state.similar ? (
          <Link href="/research/shorts-channels" className="muted">
            Clear all
          </Link>
        ) : null}
      </div>

      {channels.length === 0 && similarMode && !target ? null : channels.length === 0 ? (
        <div className="card empty">
          {similarMode
            ? "No similar Shorts channels match yet. Matches fill in as the library is indexed; loosen the filters or check back later."
            : terms.length > 0
            ? "No saved Shorts channels match yet. Use “Find new on YouTube” above to pull some in."
            : "No Shorts channels match these filters."}
        </div>
      ) : (
        <div className="channel-list">
          {channels.map((channel) => (
            <ChannelCard
              key={channel.channel_id}
              channel={{ ...channel, tracked: followed.has(channel.channel_id) }}
              showVideos={showVideos}
              highlightGrowth={isRealtimeSort(state.sort)}
              findSimilar={similar.enabled}
            />
          ))}
        </div>
      )}

      {canLoadMore ? (
        <div className="load-more">
          <Link href={buildHref(state, { limit: String(Number(state.limit) + PAGE_SIZE) })} className="toolbar-button" scroll={false}>
            Show more channels
          </Link>
        </div>
      ) : null}
    </div>
  );
}
