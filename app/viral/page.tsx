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
import { RANGES, SORTS, readState, viralHref, type TermParam, type ViralState } from "./options";

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
  // No breakdowns table yet (migration not applied): show the plain feed rather than fail the page.
  const matching = filtering
    ? await repositories.breakdowns.videoIdsWhere({ style: state.style, hookType: state.hook, angle: state.angle }, 600).catch(() => null)
    : null;
  const videos = await repositories.videos.feed({
    orderBy: state.sort,
    limit: 60,
    publishedAfter: state.range === "all" ? undefined : daysAgo(Number(state.range)),
    format: state.format === "all" ? undefined : (state.format as VideoFormat),
    discovery: true,
    ...(matching ? { videoIds: matching } : {}),
  });
  const breakdowns: Map<string, VideoBreakdownRow> = await repositories.breakdowns.forVideos(videos.map((v) => v.video_id)).catch(() => new Map());

  if (videos.length === 0) {
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

  return (
    <>
      <WhatWorks videos={videos} breakdowns={breakdowns} state={state} />
      <WatchGrid items={watchItems(videos)}>
        {videos.map((video) => (
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
 * What the videos on screen have in common, from Claude's read of each: the
 * hooks, styles and angles that turn up most, how often, and how far those
 * videos beat their channels. Each one filters the page to it.
 */
function WhatWorks({ videos, breakdowns, state }: { videos: VideoFeedRow[]; breakdowns: Map<string, VideoBreakdownRow>; state: ViralState }) {
  const explained = videos.filter((v) => breakdowns.has(v.video_id));
  const scores = videos.map((v) => v.outlier_score).filter((s): s is number => s !== null);
  const typical = median(scores);
  const top = scores.length ? Math.max(...scores) : null;
  const channels = new Set(videos.map((v) => v.youtube_channel_id)).size;
  const range = RANGES.find((r) => r.key === state.range)?.label.toLowerCase();
  const sort = SORTS.find((s) => s.key === state.sort)?.label.toLowerCase();

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
      .slice(0, 4);
    return { ...column, rows };
  });

  return (
    <section className="vv-works" aria-labelledby="vv-works-title">
      <div className="vv-works-head">
        <div>
          <h2 id="vv-works-title">What these {videos.length} have in common</h2>
          <p>
            {state.range === "all" ? "All time" : `Last ${range}`}, by {sort}, from {channels} channel{channels === 1 ? "" : "s"}.{" "}
            {explained.length > 0 ? `Claude has explained ${explained.length} of them; click a pattern to see only those.` : "Claude hasn't explained any of these yet."}
          </p>
        </div>
        <dl className="vv-works-stats">
          {typical !== null ? (
            <div>
              <dt>Typical</dt>
              <dd>{formatMultiplier(typical)}</dd>
            </div>
          ) : null}
          {top !== null ? (
            <div>
              <dt>Top</dt>
              <dd>{formatMultiplier(top)}</dd>
            </div>
          ) : null}
        </dl>
      </div>
      {explained.length >= 3 ? (
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
                        style={{ "--share": row.count / explained.length, "--i": c * 4 + i } as CSSProperties}
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
      ) : null}
    </section>
  );
}
