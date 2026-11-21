import { FlameIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import { VideoCard } from "@/components/video-card";
import { daysAgo } from "@/lib/format";
import { requireApprovedUser } from "@/lib/auth/session";
import { Paywall } from "@/components/paywall";
import { paidFeaturesLocked } from "@/lib/billing/feature-gate";
import { PAID_FEATURES } from "@/lib/billing/features";
import { Dropdown } from "@/components/dropdown";
import { ANGLES, HOOK_TYPES, VIDEO_STYLES, termLabel } from "@/lib/breakdowns/taxonomy";
import { getServices } from "@/lib/services";
import type { VideoFormat } from "@/types/database";

export const dynamic = "force-dynamic";

const RANGES = [
  { key: "1", label: "24 hours" },
  { key: "2", label: "48 hours" },
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "all", label: "All time" },
] as const;

const FORMATS = [
  { key: "all", label: "All" },
  { key: "long_form", label: "Videos" },
  { key: "short", label: "Shorts" },
] as const;

const SORTS = [
  { key: "outlier_score", label: "Outlier score" },
  { key: "views_per_day", label: "Views / day" },
  { key: "view_count", label: "Total views" },
] as const;

/** Filters on Claude's breakdowns: only videos it has explained can match. */
const BREAKDOWN_FILTERS = [
  { param: "style", label: "Style", terms: VIDEO_STYLES },
  { param: "hook", label: "Hook", terms: HOOK_TYPES },
  { param: "angle", label: "Angle", terms: ANGLES },
] as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function pick<T extends readonly { key: string }[]>(options: T, value: unknown, fallback: T[number]["key"]): T[number]["key"] {
  return options.some((o) => o.key === value) ? (value as T[number]["key"]) : fallback;
}

export default async function ViralPage({ searchParams }: { searchParams: SearchParams }) {
  const current = await requireApprovedUser();
  // Free is Shorts Channels only: show the paywall before loading anything.
  if (await paidFeaturesLocked(current)) return <Paywall feature={PAID_FEATURES["viral"]} />;
  const params = await searchParams;
  const range = pick(RANGES, params.range, "30");
  const format = pick(FORMATS, params.format, "all");
  const sort = pick(SORTS, params.sort, "outlier_score");

  const chosen = {
    style: typeof params.style === "string" && params.style in VIDEO_STYLES ? params.style : "",
    hook: typeof params.hook === "string" && params.hook in HOOK_TYPES ? params.hook : "",
    angle: typeof params.angle === "string" && params.angle in ANGLES ? params.angle : "",
  };
  const filtering = Boolean(chosen.style || chosen.hook || chosen.angle);

  const { repositories } = getServices();
  // No breakdowns table yet (migration not applied): show the plain feed rather than fail the page.
  const matching = filtering
    ? await repositories.breakdowns.videoIdsWhere({ style: chosen.style, hookType: chosen.hook, angle: chosen.angle }, 600).catch(() => null)
    : null;
  const videos = await repositories.videos.feed({
    orderBy: sort,
    limit: 60,
    publishedAfter: range === "all" ? undefined : daysAgo(Number(range)),
    format: format === "all" ? undefined : (format as VideoFormat),
    discovery: true,
    ...(matching ? { videoIds: matching } : {}),
  });
  const breakdowns = await repositories.breakdowns.forVideos(videos.map((v) => v.video_id)).catch(() => new Map());

  const href = (overrides: Record<string, string>) => {
    const next = new URLSearchParams({ range, format, sort, ...chosen, ...overrides });
    for (const [key, value] of [...next.entries()]) if (!value) next.delete(key);
    return `/viral?${next.toString()}`;
  };

  return (
    <div className="stack">
      <PageHeader icon={FlameIcon} title="Viral Videos" subtitle="Videos ranked by how far they beat their channel’s typical views." />

      <div className="row" style={{ gap: 20 }}>
        <div className="chips chips-scroll" aria-label="Published within">
          {RANGES.map((o) => (
            <Link key={o.key} href={href({ range: o.key })} className="chip" aria-current={o.key === range}>
              {o.label}
            </Link>
          ))}
        </div>
        <div className="chips chips-scroll" aria-label="Format">
          {FORMATS.map((o) => (
            <Link key={o.key} href={href({ format: o.key })} className="chip" aria-current={o.key === format}>
              {o.label}
            </Link>
          ))}
        </div>
        <div className="chips chips-scroll" aria-label="Sort by">
          {SORTS.map((o) => (
            <Link key={o.key} href={href({ sort: o.key })} className="chip" aria-current={o.key === sort}>
              {o.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="row breakdown-filters" aria-label="Filter by what made them work">
        <span className="muted">What worked</span>
        {BREAKDOWN_FILTERS.map((filter) => {
          const current = chosen[filter.param];
          return (
            <Dropdown
              key={filter.param}
              className={`filter-dropdown ${current ? "is-set" : ""}`}
              label={
                <span>
                  {filter.label}: <strong>{termLabel(filter.terms, current) ?? "Any"}</strong>
                </span>
              }
            >
              <Link href={href({ [filter.param]: "" })} className="dropdown-item" aria-current={!current}>
                Any
              </Link>
              {Object.entries(filter.terms)
                .filter(([key]) => key !== "other")
                .map(([key, term]) => (
                  <Link key={key} href={href({ [filter.param]: key })} className="dropdown-item" title={term.description} aria-current={key === current}>
                    {term.label}
                  </Link>
                ))}
            </Dropdown>
          );
        })}
        {filtering ? (
          <Link href={href({ style: "", hook: "", angle: "" })} className="muted">
            Clear
          </Link>
        ) : null}
      </div>

      {videos.length === 0 ? (
        <div className="card empty">
          {filtering ? (
            <>No explained videos match these filters yet. Breakdowns are added every hour, so try a wider date range or check back soon.</>
          ) : (
            <>
              No videos match. <Link href="/channels">Track more channels</Link> or widen the date range.
            </>
          )}
        </div>
      ) : (
        <div className="video-grid">
          {videos.map((video) => (
            <VideoCard key={video.video_id} video={video} breakdown={breakdowns.get(video.video_id)} />
          ))}
        </div>
      )}
    </div>
  );
}
