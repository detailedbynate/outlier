import Link from "next/link";
import { Dropdown } from "@/components/dropdown";
import { ChevronDownIcon, FlameIcon, SearchIcon, ShortsIcon, SlidersIcon, SortIcon, VideoIcon, VideoOffIcon, ZapIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { requireApprovedUser } from "@/lib/auth/session";
import { timeAgo } from "@/lib/format";
import { getServices } from "@/lib/services";
import { ChannelCard } from "./channel-card";
import { DiscoverForm } from "./discover-form";
import {
  ACTIVITY,
  AVG_VIEWS,
  activeQuickFilter,
  buildHref,
  CHANNEL_AGE,
  clearedAdvanced,
  countAdvanced,
  isRealtimeSort,
  COUNTRIES,
  label,
  MAX_LIMIT,
  PAGE_SIZE,
  parseState,
  QUICK_FILTERS,
  SHORTS_SHARE,
  SORTS,
  SUBSCRIBERS,
  toFilters,
} from "./filters";

export const dynamic = "force-dynamic";
// Discovery ingests channels inside the server action.
export const maxDuration = 60;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ShortsChannelsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireApprovedUser();
  const state = parseState(await searchParams);
  const showVideos = state.videos !== "hide";

  const advancedCount = countAdvanced(state);
  const quick = activeQuickFilter(state);
  // Trending picks show on the default view, before the user searches or filters.
  const isDefaultView = !state.q && advancedCount === 0 && !quick;

  const { research, trending } = getServices();
  const [{ channels, terms }, popular, searchesLeft, picks] = await Promise.all([
    research.browseShortsChannels(state.q, toFilters(state), showVideos ? 8 : 0),
    research.popularKeywords(10),
    research.discoverySearchesLeftToday(),
    isDefaultView ? trending.latestPicks() : Promise.resolve(null),
  ]);
  const trendingChannels = picks ? await research.trendingToday(picks.picks, showVideos ? 8 : 0) : [];
  const canLoadMore = channels.length === Number(state.limit) && Number(state.limit) < MAX_LIMIT;
  const discoverKeyword = terms[0] ?? "";

  const select = (name: string, options: { key: string; label: string }[], value: string) => (
    <label className="field">
      <span>{
        { subs: "Subscribers", views: "Average views", age: "Channel age", active: "Last upload", share: "Shorts share", country: "Country" }[name]
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
      <form method="get" action="/research/shorts-channels" className="search-hero" role="search">
        <SearchIcon size={18} className="search-hero-icon" />
        <label htmlFor="q" className="sr-only">
          Search channels by niche
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={state.q}
          placeholder={'Search "recipe, cooking, food" to find food channels'}
          autoComplete="off"
        />
        {Object.entries(state).map(([key, value]) =>
          key === "q" || key === "limit" || value === "any" || (key === "sort" && value === "views") || (key === "videos" && value === "show") ? null : (
            <input key={key} type="hidden" name={key} value={value} />
          ),
        )}
      </form>

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
                href={buildHref(state, { ...clearedAdvanced(), sort: "views", ...preset.params, limit: String(PAGE_SIZE) })}
                className="dropdown-item"
                aria-current={quick?.key === preset.key}
              >
                <span>{preset.label}</span>
                <span className="dropdown-item-note">{preset.description}</span>
              </Link>
            ))}
            {quick ? (
              <Link href={buildHref(state, { ...clearedAdvanced(), sort: "views" })} className="dropdown-item dropdown-item-muted">
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
            {(["Channel", "Realtime"] as const).map((group) => (
              <div key={group} className="dropdown-group">
                <div className="dropdown-group-title">
                  {group === "Realtime" ? <ZapIcon size={12} /> : null}
                  {group === "Realtime" ? "Realtime growth" : "Channel stats"}
                </div>
                {SORTS.filter((sort) => sort.group === group).map((sort) => (
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
              {state.sort !== "views" ? <input type="hidden" name="sort" value={state.sort} /> : null}
              {state.videos === "hide" ? <input type="hidden" name="videos" value="hide" /> : null}
              {select("subs", SUBSCRIBERS, state.subs)}
              {select("views", AVG_VIEWS, state.views)}
              {select("age", CHANNEL_AGE, state.age)}
              {select("active", ACTIVITY, state.active)}
              {select("share", SHORTS_SHARE, state.share)}
              {select("country", COUNTRIES, state.country)}
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

      {trendingChannels.length > 0 ? (
        <section className="trending-section" aria-labelledby="trending-title">
          <div className="section-head">
            <span className="section-icon">
              <FlameIcon size={16} />
            </span>
            <div>
              <h2 id="trending-title">Trending today</h2>
              <p className="stat-note">
                Breakout Shorts channels across {trendingChannels.length} niches
                {picks?.updatedAt ? ` · updated ${timeAgo(picks.updatedAt)}` : ""}
              </p>
            </div>
          </div>
          <div className="channel-list">
            {trendingChannels.map((channel) => (
              <ChannelCard key={channel.channel_id} channel={channel} showVideos={showVideos} badge={channel.niche} />
            ))}
          </div>
        </section>
      ) : null}

      {isDefaultView && trendingChannels.length > 0 ? <h2 className="section-title">All Shorts channels</h2> : null}

      <div className="results-meta">
        <span>
          {channels.length === 0
            ? "No channels found"
            : `${canLoadMore ? `Top ${channels.length}` : channels.length} ${channels.length === 1 ? "channel" : "channels"}`}
          {terms.length > 0 ? ` matching ${terms.map((t) => `“${t}”`).join(", ")}` : ""}
        </span>
        {isRealtimeSort(state.sort) ? <span className="muted">Growth since the snapshot ~24h/48h earlier · channels without history yet are listed last</span> : null}
        {advancedCount > 0 || state.q ? (
          <Link href="/research/shorts-channels" className="muted">
            Clear all
          </Link>
        ) : null}
      </div>

      {channels.length === 0 ? (
        <div className="card empty">
          {terms.length > 0
            ? "No saved Shorts channels match yet. Discover some from YouTube below."
            : "No Shorts channels match these filters."}
        </div>
      ) : (
        <div className="channel-list">
          {channels.map((channel) => (
            <ChannelCard key={channel.channel_id} channel={channel} showVideos={showVideos} highlightGrowth={isRealtimeSort(state.sort)} />
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

      <DiscoverForm keyword={discoverKeyword} searchesLeft={searchesLeft} />
    </div>
  );
}
