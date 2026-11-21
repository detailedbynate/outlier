/* eslint-disable @next/next/no-img-element -- YouTube avatars and thumbnails are already CDN-optimized */
import Link from "next/link";
import type { CSSProperties } from "react";
import { TrackChannelForm } from "@/components/track-channel-form";
import { daysAgo, formatCompact, formatMultiplier, timeAgo } from "@/lib/format";
import { requireApprovedUser } from "@/lib/auth/session";
import { Paywall } from "@/components/paywall";
import { paidFeaturesLocked } from "@/lib/billing/feature-gate";
import { PAID_FEATURES } from "@/lib/billing/features";
import { channelGrowth, type ChannelGrowth } from "@/lib/analytics/dashboard";
import { getServices } from "@/lib/services";
import type { ChannelRow, VideoFeedRow } from "@/types/database";
import { setChannelTracked } from "../research/shorts-channels/actions";

export const dynamic = "force-dynamic";

const SORTS = [
  { key: "week", label: "Views this week" },
  { key: "subs", label: "Subscribers" },
  { key: "added", label: "Recently added" },
] as const;

type SortKey = (typeof SORTS)[number]["key"];
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

interface Tracked {
  channel: ChannelRow;
  growth: ChannelGrowth;
  subs: number[];
  latest: VideoFeedRow | null;
  order: number;
}

/**
 * The channels someone tracks, each with how it moved this week: subscribers
 * over the last eight days as a line, what it gained, and its newest upload
 * with how that's doing against the channel's usual.
 */
export default async function ChannelsPage({ searchParams }: { searchParams: SearchParams }) {
  const current = await requireApprovedUser();
  // Free is Shorts Channels only: show the paywall before loading anything.
  if (await paidFeaturesLocked(current)) return <Paywall feature={PAID_FEATURES["tracked"]} />;
  const params = await searchParams;
  const sort: SortKey = SORTS.find((s) => s.key === params.sort)?.key ?? "week";

  const { repositories } = getServices();
  const channels = await repositories.channels.listFollowed(current.user.id, { limit: 200 });
  const ids = channels.map((c) => c.id);
  const [snapshots, uploads] = await Promise.all([
    repositories.channels.snapshotsForChannels(ids, daysAgo(8)).catch(() => []),
    repositories.videos.feed({ channelIds: ids, orderBy: "published_at", publishedAfter: daysAgo(60), limit: Math.min(ids.length * 4, 600) }).catch(() => []),
  ]);

  const snapshotsBy = new Map<string, typeof snapshots>();
  for (const s of snapshots) snapshotsBy.set(s.channel_id, [...(snapshotsBy.get(s.channel_id) ?? []), s]);
  const latestBy = new Map<string, VideoFeedRow>();
  for (const video of uploads) if (!latestBy.has(video.channel_id)) latestBy.set(video.channel_id, video);

  const tracked: Tracked[] = channels.map((channel, order) => {
    const history = snapshotsBy.get(channel.id) ?? [];
    return {
      channel,
      growth: channelGrowth(history),
      subs: history.map((h) => h.subscriber_count).filter((v): v is number => v !== null),
      latest: latestBy.get(channel.id) ?? null,
      order,
    };
  });
  const sorted = tracked.toSorted((a, b) =>
    sort === "subs"
      ? (b.channel.subscriber_count ?? -1) - (a.channel.subscriber_count ?? -1)
      : sort === "added"
        ? a.order - b.order
        : (b.growth.views7d ?? -1) - (a.growth.views7d ?? -1),
  );

  const subsWeek = tracked.reduce((sum, t) => sum + Math.max(t.growth.subs7d ?? 0, 0), 0);
  const viewsWeek = tracked.reduce((sum, t) => sum + (t.growth.views7d ?? 0), 0);
  const month = daysAgo(30).getTime();
  const best = uploads.filter((v) => Date.parse(v.published_at) >= month && v.outlier_score !== null).toSorted((a, b) => b.outlier_score! - a.outlier_score!)[0];
  const index = SORTS.findIndex((s) => s.key === sort);

  return (
    <div className="stack tc">
      <header className="dash-hero tc-hero">
        <div className="dash-hero-text">
          <h1>Tracked Channels</h1>
          <p>The channels you keep an eye on, refreshed every day: how each one moved this week and how its newest upload is doing. Only you can see this list.</p>
        </div>
      </header>

      <section className="tc-add" aria-label="Track a channel">
        <div>
          <h2>Track a channel</h2>
          <p>Paste a handle, link or channel ID. Its numbers start filling in within a minute.</p>
        </div>
        <TrackChannelForm />
      </section>

      {tracked.length === 0 ? (
        <div className="card empty tc-empty">
          <strong>No channels yet</strong>
          <span>Track a competitor or a channel you admire above, and this page shows how it grows each day and how every new upload lands.</span>
        </div>
      ) : (
        <>
          <dl className="tc-sum">
            <div style={{ "--i": 0 } as CSSProperties}>
              <dt>Subscribers gained this week</dt>
              <dd>+{formatCompact(subsWeek)}</dd>
              <small>across {tracked.length} channel{tracked.length === 1 ? "" : "s"}</small>
            </div>
            <div style={{ "--i": 1 } as CSSProperties}>
              <dt>Views gained this week</dt>
              <dd>+{formatCompact(viewsWeek)}</dd>
              <small>from the daily refreshes</small>
            </div>
            <div className="tc-sum-best" style={{ "--i": 2 } as CSSProperties}>
              <dt>Best upload this month</dt>
              {best ? (
                <>
                  <dd>
                    <span className="tc-score">{formatMultiplier(best.outlier_score)}</span>
                    <a href={`https://www.youtube.com/watch?v=${best.youtube_video_id}`} target="_blank" rel="noreferrer" title={best.title}>
                      {best.title}
                    </a>
                  </dd>
                  <small>{best.channel_title}</small>
                </>
              ) : (
                <>
                  <dd>—</dd>
                  <small>No uploads in the last 30 days</small>
                </>
              )}
            </div>
          </dl>

          <section className="tc-list-card" aria-label="Your tracked channels">
            <div className="tc-list-head">
              <h2>
                {tracked.length} tracked channel{tracked.length === 1 ? "" : "s"}
              </h2>
              <div className="vv-seg" role="group" aria-label="Sort by" style={{ "--n": SORTS.length, "--i": index } as CSSProperties}>
                <span className="vv-seg-ink" aria-hidden="true" />
                {SORTS.map((s) => (
                  <Link key={s.key} href={s.key === "week" ? "/channels" : `/channels?sort=${s.key}`} className="vv-seg-opt" aria-current={s.key === sort ? "true" : undefined} scroll={false}>
                    {s.label}
                  </Link>
                ))}
              </div>
            </div>
            <div className="tc-cols" aria-hidden="true">
              <span>Channel</span>
              <span>Last 8 days</span>
              <span>Subscribers</span>
              <span>Views this week</span>
              <span>Newest upload</span>
              <span />
            </div>
            <ol className="tc-list">
              {sorted.map((t, i) => (
                <TrackedRow key={t.channel.id} tracked={t} index={i} />
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}

function TrackedRow({ tracked: { channel, growth, subs, latest }, index }: { tracked: Tracked; index: number }) {
  return (
    <li className="tc-row" style={{ "--i": Math.min(index, 14) } as CSSProperties}>
      <Link href={`/channels/${channel.youtube_channel_id}`} className="tc-who">
        {channel.thumbnail_url ? <img className="tc-avatar" src={channel.thumbnail_url} alt="" loading="lazy" /> : <span className="tc-avatar" />}
        <span className="tc-who-text">
          <strong>{channel.title}</strong>
          <small>
            {channel.handle ? `${channel.handle.startsWith("@") ? "" : "@"}${channel.handle} · ` : ""}synced {timeAgo(channel.last_synced_at)}
          </small>
        </span>
      </Link>

      <TrendLine points={subs} />

      <div className="tc-num" data-label="Subscribers">
        <strong>{channel.hidden_subscriber_count ? "Hidden" : formatCompact(channel.subscriber_count)}</strong>
        <Change value={growth.subs7d} />
      </div>

      <div className="tc-num" data-label="Views this week">
        <strong>{growth.views7d === null ? "—" : `+${formatCompact(growth.views7d)}`}</strong>
        <small>{growth.views24h === null ? "needs a few days" : `+${formatCompact(growth.views24h)} today`}</small>
      </div>

      {latest ? (
        <a className="tc-latest" href={`https://www.youtube.com/watch?v=${latest.youtube_video_id}`} target="_blank" rel="noreferrer" title={latest.title}>
          {latest.thumbnail_url ? <img src={latest.thumbnail_url} alt="" loading="lazy" /> : <span className="tc-latest-blank" />}
          <span className="tc-latest-text">
            <span className="tc-latest-title">{latest.title}</span>
            <small>
              {latest.outlier_score !== null ? <span className="tc-score">{formatMultiplier(latest.outlier_score)}</span> : null}
              {formatCompact(latest.view_count)} views · {timeAgo(latest.published_at)}
            </small>
          </span>
        </a>
      ) : (
        <span className="tc-latest tc-latest-none">No uploads in 60 days</span>
      )}

      <form action={setChannelTracked} className="tc-remove">
        <input type="hidden" name="channelId" value={channel.id} />
        <input type="hidden" name="tracked" value="false" />
        <button type="submit" className="button-ghost button-small" aria-label={`Stop tracking ${channel.title}`} title="Stop tracking">
          Remove
        </button>
      </form>
    </li>
  );
}

function Change({ value }: { value: number | null }) {
  if (value === null) return <small>needs a few days</small>;
  if (value === 0) return <small>no change this week</small>;
  return (
    <small data-tone={value > 0 ? "up" : "down"}>
      {value > 0 ? "+" : "−"}
      {formatCompact(Math.abs(value))} this week
    </small>
  );
}

/** Subscribers over the last eight days, drawn in when the row arrives. */
function TrendLine({ points }: { points: number[] }) {
  if (points.length < 2) return <span className="tc-spark tc-spark-empty">Fills in after a few syncs</span>;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const xy = points.map((v, i) => [(i / (points.length - 1)) * 100, 34 - ((v - min) / span) * 28] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  return (
    <span className="tc-spark" data-flat={max === min ? "" : undefined}>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
        <path d={line} pathLength={1} />
      </svg>
    </span>
  );
}
