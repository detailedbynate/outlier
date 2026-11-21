import Link from "next/link";
import type { CSSProperties } from "react";
import { VideoCard } from "@/components/video-card";
import { WatchGrid } from "@/components/watch-grid";
import { watchItems } from "@/components/watch-items";
import { daysAgo, formatMultiplier } from "@/lib/format";
import { median } from "@/lib/analytics/metrics";
import { requireApprovedUser } from "@/lib/auth/session";
import { Paywall } from "@/components/paywall";
import { paidFeaturesLocked } from "@/lib/billing/feature-gate";
import { PAID_FEATURES } from "@/lib/billing/features";
import { ANGLES, HOOK_TYPES, VIDEO_STYLES, termDescription, termLabel } from "@/lib/breakdowns/taxonomy";
import { getServices } from "@/lib/services";
import type { VideoBreakdownRow, VideoFeedRow, VideoFormat } from "@/types/database";
import { RANGES, readState, viralHref, type TermParam, type ViralState } from "./options";

export const dynamic = "force-dynamic";

const TERMS = { style: VIDEO_STYLES, hook: HOOK_TYPES, angle: ANGLES } as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ViralPage({ searchParams }: { searchParams: SearchParams }) {
  const current = await requireApprovedUser();
  // Free is Shorts Channels only: show the paywall before loading anything.
  if (await paidFeaturesLocked(current)) return <Paywall feature={PAID_FEATURES["viral"]} />;
  const params = await searchParams;
  const state = readState(
    (key) => params[key],
    (param, key) => key in TERMS[param],
  );
  const filtering = Boolean(state.style || state.hook || state.angle);

  const { repositories } = getServices();
  const window = {
    publishedAfter: state.range === "all" ? undefined : daysAgo(Number(state.range)),
    format: state.format === "all" ? undefined : (state.format as VideoFormat),
    discovery: true,
  };
  // Every explained video that fits the filters (all of them when none are set). It's what the
  // patterns panel reads, and with a filter set it's the grid too. No breakdowns table yet
  // (migration not applied): the plain feed, no patterns.
  const explainedIds = await repositories.breakdowns.videoIdsWhere({ style: state.style, hookType: state.hook, angle: state.angle }, 600).catch(() => null);
  const [videos, explained] = await Promise.all([
    filtering && explainedIds ? Promise.resolve(null) : repositories.videos.feed({ ...window, orderBy: state.sort, limit: 60 }),
    explainedIds ? repositories.videos.feed({ ...window, orderBy: state.sort, limit: 600, videoIds: explainedIds }) : Promise.resolve([]),
  ]);
  const shown = videos ?? explained.slice(0, 60);
  const breakdowns: Map<string, VideoBreakdownRow> = await repositories.breakdowns.forVideos([...new Set([...shown, ...explained].map((v) => v.video_id))]).catch(() => new Map());

  if (shown.length === 0) {
    return (
      <div className="card empty vv-empty">
        {filtering ? (
          <>No explained videos match these filters yet. Breakdowns are added every hour, so try a wider date range or check back soon.</>
        ) : (
          <>
            No videos match. <Link href="/channels">Track more channels</Link> or widen the date range.
          </>
        )}
      </div>
    );
  }

  const scores = shown.map((v) => v.outlier_score).filter((x): x is number => x !== null);
  const typical = median(scores);
  const channels = new Set(shown.map((v) => v.youtube_channel_id)).size;

  return (
    <>
      <WhatWorks explained={explained.filter((v) => breakdowns.has(v.video_id))} breakdowns={breakdowns} state={state} />
      <p className="vv-meta">
        <strong>{shown.length}</strong> video{shown.length === 1 ? "" : "s"} from {channels} channel{channels === 1 ? "" : "s"}
        {typical !== null ? (
          <>
            , typically <span className="vv-meta-score">{formatMultiplier(typical)}</span> their channel&apos;s usual views
          </>
        ) : null}
        . <span className="vv-meta-hint">Click a thumbnail to watch it here.</span>
      </p>
      <WatchGrid items={watchItems(shown)}>
        {shown.map((video) => (
          <VideoCard key={video.video_id} video={video} breakdown={breakdowns.get(video.video_id)} />
        ))}
      </WatchGrid>
    </>
  );
}

const COLUMNS: { param: TermParam; field: "hook_type" | "style" | "angle"; title: string }[] = [
  { param: "hook", field: "hook_type", title: "Hooks" },
  { param: "style", field: "style", title: "Styles" },
  { param: "angle", field: "angle", title: "Angles" },
];

/**
 * What's working, from Claude's read of every explained video that fits the
 * filters: the hooks, styles and angles that turn up most, how often, and how
 * far those videos beat their channels. Each one filters the page to it.
 */
function WhatWorks({ explained, breakdowns, state }: { explained: VideoFeedRow[]; breakdowns: Map<string, VideoBreakdownRow>; state: ViralState }) {
  if (explained.length < 3) return null;
  const range = RANGES.find((r) => r.key === state.range)?.label.toLowerCase();

  const columns = COLUMNS.map((column) => {
    const groups = new Map<string, number[]>();
    for (const video of explained) {
      const key = breakdowns.get(video.video_id)![column.field];
      if (!key || key === "other") continue;
      groups.set(key, [...(groups.get(key) ?? []), video.outlier_score ?? 0]);
    }
    const rows = [...groups.entries()]
      .map(([key, list]) => ({ key, count: list.length, median: median(list.filter((s) => s > 0)) }))
      .sort((a, b) => b.count - a.count || (b.median ?? 0) - (a.median ?? 0))
      .slice(0, 5);
    return { ...column, rows };
  });

  return (
    <section className="vv-works" aria-labelledby="vv-works-title">
      <div className="vv-works-head">
        <div>
          <h2 id="vv-works-title">What&apos;s working {state.range === "all" ? "overall" : `in the last ${range}`}</h2>
          <p>
            Patterns across the {explained.length} viral videos Claude has explained that fit these filters. The bar is how many use it;
            &ldquo;typical&rdquo; is how far those videos beat their channel&apos;s usual. Click one to see only those.
          </p>
        </div>
      </div>
      <div className="vv-works-cols">
          {columns.map((column, c) => (
            <div key={column.param} className="vv-works-col">
              <h3>{column.title}</h3>
              <ol>
                {column.rows.map((row, i) => {
                  const on = state[column.param] === row.key;
                  return (
                    <li key={row.key}>
                      <Link
                        href={viralHref(state, { [column.param]: on ? "" : row.key })}
                        className="vv-work"
                        data-on={on ? "" : undefined}
                        title={termDescription(TERMS[column.param], row.key)}
                        scroll={false}
                        style={{ "--share": row.count / explained.length, "--i": c * 5 + i } as CSSProperties}
                      >
                        <span className="vv-work-label">{termLabel(TERMS[column.param], row.key)}</span>
                        <span className="vv-work-count">
                          {row.count} <small>of {explained.length}</small>
                        </span>
                        <span className="vv-work-bar" aria-hidden="true" />
                        {row.median !== null ? <span className="vv-work-median">{formatMultiplier(row.median)} typical</span> : null}
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
      </div>
    </section>
  );
}
