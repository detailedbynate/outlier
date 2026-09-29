/* eslint-disable @next/next/no-img-element -- YouTube images are already CDN-optimized */
import Link from "next/link";
import { cache, type ComponentType, type CSSProperties, type ReactNode } from "react";
import {
  BookmarkIcon,
  ChartIcon,
  CompassIcon,
  FlameIcon,
  LockIcon,
  PenIcon,
  PlayCircleIcon,
  SearchIcon,
  ShortsIcon,
  TrendingIcon,
  UsersIcon,
  ZapIcon,
} from "@/components/icons";
import type { ActivityItem } from "@/lib/analytics/dashboard";
import { formatCompact, formatMultiplier, formatPercent, timeAgo } from "@/lib/format";
import { getServices } from "@/lib/services";
import type { ChannelSummary } from "@/lib/services/dashboard-service";
import type { SavedNiche } from "@/lib/niches/saved";
import type { VideoFeedRow } from "@/types/database";

type IconType = ComponentType<{ size?: number }>;
type Tone = "violet" | "pink" | "green" | "amber" | "blue";

/* The same numbers feed several cards; fetch them once per request. */
const loadYourChannels = cache((userId: string, own: string | null) => getServices().dashboard.yourChannels(userId, own));
const loadOverview = cache((userId: string, lastVisitAt: string | null) => getServices().dashboard.overview(userId, lastVisitAt));
// Keyed by a string: cache() compares arguments by identity, and each caller builds its own array.
const loadPulse = cache((niches: string, lastVisitAt: string | null) => getServices().dashboard.nichePulse(niches ? niches.split("\n") : [], lastVisitAt));

/* ---------------------------------------------------------------------------
   Building blocks
--------------------------------------------------------------------------- */

export function Panel({
  icon: Icon,
  title,
  subtitle,
  action,
  children,
  className = "",
  tone = "violet",
  index = 0,
}: {
  icon?: IconType;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: Tone;
  index?: number;
}) {
  return (
    <section className={`dash-panel ${className}`} style={{ "--i": index } as CSSProperties} aria-label={title}>
      <header className="dash-panel-head">
        {Icon ? (
          <span className="dash-icon" data-tone={tone}>
            <Icon size={16} />
          </span>
        ) : null}
        <div className="dash-panel-titles">
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {action ? <div className="dash-panel-action">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="dash-empty">
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

function Delta({ value, suffix }: { value: number | null; suffix?: string }) {
  if (value === null) return <span className="dash-delta" data-dir="none">—{suffix ? ` ${suffix}` : ""}</span>;
  const dir = value > 0 ? "up" : value < 0 ? "down" : "flat";
  return (
    <span className="dash-delta" data-dir={dir}>
      {value > 0 ? "+" : value < 0 ? "−" : ""}
      {formatCompact(Math.abs(value))}
      {suffix ? ` ${suffix}` : ""}
    </span>
  );
}

export function PanelSkeleton({ className = "", rows = 3 }: { className?: string; rows?: number }) {
  return (
    <div className={`dash-panel dash-skeleton ${className}`} aria-hidden="true">
      <div className="dash-panel-head">
        <span className="sk sk-icon" />
        <div className="dash-panel-titles">
          <span className="sk sk-title" />
          <span className="sk sk-line" />
        </div>
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="sk sk-row" />
      ))}
    </div>
  );
}

function Avatar({ src, large = false }: { src: string | null; large?: boolean }) {
  const className = `dash-avatar${large ? " home-avatar-xl" : ""}`;
  return src ? <img className={className} src={src} alt="" loading="lazy" /> : <span className={className} />;
}

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** A colour partway along a scale of hex stops, for bars that brighten with their value. `t` is 0 to 1. */
function scale(stops: readonly string[], t: number): string {
  const clamped = Math.min(Math.max(t, 0), 1) * (stops.length - 1);
  const i = Math.min(Math.floor(clamped), stops.length - 2);
  const f = clamped - i;
  const rgb = (hex: string) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  const [a, b] = [rgb(stops[i]!), rgb(stops[i + 1]!)];
  return `rgb(${a.map((v, k) => Math.round(v + (b[k]! - v) * f)).join(" ")})`;
}

/** Slow to hot: dim brown through amber to orange-red. */
const HEAT = ["#78350f", "#d97706", "#fbbf24", "#f97316", "#ef4444"] as const;
/** Competitors, smallest to biggest. */
const PINK = ["#5b1f3d", "#9d2b66", "#db2777", "#f472b6"] as const;
/** You, same idea in violet. */
const VIOLET = ["#3b1f78", "#6d28d9", "#8b5cf6", "#c4b5fd"] as const;

/** Inline colour and glow for a bar; `t` is how close it is to the top value. */
function barStyle(stops: readonly string[], t: number, width: string): CSSProperties {
  return { width, "--bar": scale(stops, t), "--glow": `${Math.round(4 + t * 14)}px`, "--glow-strength": `${Math.round(20 + t * 60)}%` } as CSSProperties;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/* ---------------------------------------------------------------------------
   Header: credits
--------------------------------------------------------------------------- */

export async function CreditsPill({ userId, lastVisitAt }: { userId: string; lastVisitAt: string | null }) {
  const { credits } = await loadOverview(userId, lastVisitAt);
  const unlimited = credits.limit >= 1_000_000;
  const share = unlimited ? 1 : credits.limit > 0 ? Math.min(credits.remaining / credits.limit, 1) : 0;
  const r = 15;
  const circumference = 2 * Math.PI * r;
  return (
    <Link href="/billing" className="home-credits" title="Credits reset on the 1st">
      <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true">
        <circle cx="19" cy="19" r={r} className="home-ring-track" />
        <circle cx="19" cy="19" r={r} className="home-ring-fill" strokeDasharray={`${share * circumference} ${circumference}`} transform="rotate(-90 19 19)" />
      </svg>
      <span>
        <strong>{unlimited ? "Unlimited" : formatCompact(credits.remaining)}</strong>
        <small>{unlimited ? "credits" : `of ${formatCompact(credits.limit)} credits left`}</small>
      </span>
    </Link>
  );
}

/* ---------------------------------------------------------------------------
   1. Your channel: profile card, uploads chart, key numbers
--------------------------------------------------------------------------- */

/** Drops a lone reading that jumps away from both neighbours in the same direction (a bad sync, not real growth). */
function dropBlips(points: number[]): number[] {
  return points.filter((v, i) => {
    const prev = points[i - 1];
    const next = points[i + 1];
    if (prev === undefined || next === undefined) return true;
    const off = (n: number) => Math.abs(v - n) / Math.max(n, 1);
    return !(off(prev) > 0.02 && off(next) > 0.02 && Math.sign(v - prev) === Math.sign(v - next));
  });
}

function Sparkline({ points: raw }: { points: number[] }) {
  const points = dropBlips(raw);
  if (points.length < 2) return <div className="home-spark home-spark-empty">Growth chart fills in after a few daily syncs.</div>;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const xy = points.map((v, i) => [(i / (points.length - 1)) * 100, 92 - ((v - min) / span) * 80] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const [lastX, lastY] = xy[xy.length - 1]!;
  return (
    <div className="home-spark">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path d={`${line} L100,100 L0,100 Z`} className="home-spark-area" />
        <path d={line} className="home-spark-line" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="home-spark-dot" style={{ left: `${lastX}%`, top: `${lastY}%` }} />
    </div>
  );
}

function ChannelCard({ own }: { own: ChannelSummary }) {
  const { channel, growth, history, alerts } = own;
  const subs = history.map((h) => h.subs).filter((v): v is number => v !== null);
  const lastUpload = own.recent[0]?.published_at ?? null;
  return (
    <section className="dash-panel home-channel home-span-4" style={{ "--i": 0 } as CSSProperties} aria-label="Your channel">
      <header className="home-channel-head">
        <Avatar src={channel.thumbnail_url} large />
        <div className="dash-row-main">
          <span className="home-kicker">Your channel</span>
          <Link href={`/channels/${channel.youtube_channel_id}`} className="home-channel-name">
            {channel.title}
          </Link>
          {channel.handle ? <span className="dash-row-sub">{channel.handle.startsWith("@") ? channel.handle : `@${channel.handle}`}</span> : null}
        </div>
      </header>

      <div className="home-big">
        <span className="home-big-value">{formatCompact(channel.subscriber_count)}</span>
        <span className="home-big-label">
          subscribers <Delta value={growth.subs7d} suffix="this week" />
        </span>
      </div>

      <Sparkline points={subs} />

      <dl className="home-facts">
        <div>
          <dt>Views today</dt>
          <dd>
            <Delta value={growth.views24h} />
          </dd>
        </div>
        <div>
          <dt>Views this week</dt>
          <dd>
            <Delta value={growth.views7d} />
          </dd>
        </div>
        <div>
          <dt>Subs today</dt>
          <dd>
            <Delta value={growth.subs24h} />
          </dd>
        </div>
        <div>
          <dt>Last upload</dt>
          <dd>{lastUpload ? timeAgo(lastUpload) : "—"}</dd>
        </div>
      </dl>

      {alerts[0] ? (
        <p className="home-alert" data-tone={alerts[0].tone}>
          <strong>{alerts[0].title}</strong>
          <span>{alerts[0].detail}</span>
        </p>
      ) : null}
    </section>
  );
}

function UploadsChart({ videos, channelMedian }: { videos: VideoFeedRow[]; channelMedian: number | null }) {
  const bars = [...videos].reverse();
  const max = Math.max(...bars.map((v) => v.view_count), channelMedian ?? 0, 1);
  const best = bars.reduce<VideoFeedRow | null>((top, v) => (!top || Number(v.outlier_score ?? 0) > Number(top.outlier_score ?? 0) ? v : top), null);
  const pct = (n: number) => `${Math.max((n / max) * 100, 1.5)}%`;
  return (
    <section className="dash-panel home-chart home-span-8" style={{ "--i": 1 } as CSSProperties} aria-label="Your recent uploads">
      <header className="dash-panel-head">
        <div className="dash-panel-titles">
          <h2>Views per upload</h2>
          <p>Your last {bars.length} uploads · hover a bar for the video</p>
        </div>
        <div className="dash-panel-action home-legend">
          <span data-key="bar">Views</span>
          {channelMedian ? <span data-key="median">Your median · {formatCompact(channelMedian)}</span> : null}
        </div>
      </header>

      <div className="home-bars" role="list">
        <div className="home-gridlines" aria-hidden="true">
          <span data-label={formatCompact(max)} />
          <span data-label={formatCompact(max / 2)} />
          <span data-label="0" />
        </div>
        {channelMedian ? (
          <span className="home-median-plot" aria-hidden="true">
            <span className="home-median" style={{ bottom: pct(channelMedian) }} />
          </span>
        ) : null}
        {bars.map((v, i) => {
          const score = v.outlier_score === null ? null : Number(v.outlier_score);
          const isBest = v === best && (score ?? 0) >= 1.5;
          return (
            <a
              key={v.video_id}
              role="listitem"
              href={`https://www.youtube.com/watch?v=${v.youtube_video_id}`}
              target="_blank"
              rel="noreferrer"
              className="home-bar"
              data-best={isBest || undefined}
              data-edge={i < 2 ? "start" : i >= bars.length - 2 ? "end" : undefined}
              data-above={channelMedian !== null && v.view_count >= channelMedian ? "" : undefined}
              aria-label={`${v.title}: ${formatCompact(v.view_count)} views`}
            >
              <span className="home-bar-fill" style={{ height: pct(v.view_count) }}>
                {isBest ? (
                  <span className="home-bar-flag">
                    {formatMultiplier(score)} · {formatCompact(v.view_count)}
                  </span>
                ) : null}
              </span>
              <span className="home-bar-tip">
                <strong>{v.title}</strong>
                {formatCompact(v.view_count)} views{score !== null ? ` · ${formatMultiplier(score)} usual` : ""}
              </span>
              <span className="home-bar-label">{shortDate.format(new Date(v.published_at))}</span>
            </a>
          );
        })}
      </div>
    </section>
  );
}

function KeyNumbers({ own, channelMedian }: { own: ChannelSummary; channelMedian: number | null }) {
  const typical = channelMedian;
  const best = own.recent.reduce<VideoFeedRow | null>((top, v) => (!top || Number(v.outlier_score ?? 0) > Number(top.outlier_score ?? 0) ? v : top), null);
  const uploads30 = own.uploads30d;
  const rates = own.recent.map((v) => (v.engagement_rate === null ? null : Number(v.engagement_rate))).filter((v): v is number => v !== null);
  const engagement = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;

  const tiles: { label: string; value: string; note: string; tone: Tone }[] = [
    { label: "Typical views", value: formatCompact(typical), note: "your median per upload", tone: "violet" },
    {
      label: "Best recent upload",
      value: best?.outlier_score ? formatMultiplier(Number(best.outlier_score)) : "—",
      note: best ? best.title : "no uploads yet",
      tone: "pink",
    },
    { label: "Uploads · 30 days", value: uploads30 >= own.recent.length && own.recent.length > 0 ? `${uploads30}+` : String(uploads30), note: uploads30 >= 8 ? "steady schedule" : "more uploads, more chances", tone: "green" },
    { label: "Engagement", value: formatPercent(engagement), note: "likes + comments per view", tone: "amber" },
  ];

  return (
    <div className="home-tiles home-span-12">
      {tiles.map((t, i) => (
        <div key={t.label} className="dash-stat home-tile" data-tone={t.tone} style={{ "--i": i + 2 } as CSSProperties}>
          <span className="dash-stat-label">{t.label}</span>
          <span className="dash-stat-value">{t.value}</span>
          <span className="dash-stat-note" title={t.note}>
            {t.note}
          </span>
        </div>
      ))}
    </div>
  );
}

export async function YourChannelSection({ userId, ownChannel }: { userId: string; ownChannel: string | null }) {
  const data = await loadYourChannels(userId, ownChannel);
  const own = data.own;

  if (!own) {
    return (
      <section className="dash-panel home-span-12 home-onboard" aria-label="Your channel">
        <span className="dash-icon" data-tone="green">
          <PlayCircleIcon size={18} />
        </span>
        <div className="dash-panel-titles">
          <h2>{data.ownPending ? "Your channel isn't synced yet" : "Add your channel"}</h2>
          <p>
            {data.ownPending
              ? `We'll pull in ${data.ownPending} so you can see subscriber growth, views per upload, and alerts here.`
              : "See your subscriber growth, views per upload, and an alert when one of your videos breaks out."}
          </p>
        </div>
        <Link href={data.ownPending ? `/compare?you=${encodeURIComponent(data.ownPending)}` : "/settings/preferences"} className="button-ghost button-small">
          {data.ownPending ? "Load my channel" : "Add in preferences"}
        </Link>
      </section>
    );
  }

  const stored = own.recent.find((v) => v.channel_median_views !== null)?.channel_median_views;
  const channelMedian = stored != null ? Number(stored) : median(own.recent.map((v) => v.view_count));
  return (
    <>
      <ChannelCard own={own} />
      {own.recent.length > 0 ? (
        <UploadsChart videos={own.recent} channelMedian={channelMedian} />
      ) : (
        <section className="dash-panel home-span-8">
          <Empty title="No uploads stored yet">Your views-per-upload chart appears after the next sync.</Empty>
        </section>
      )}
      <KeyNumbers own={own} channelMedian={channelMedian} />
    </>
  );
}

export function YourChannelSkeleton() {
  return (
    <>
      <PanelSkeleton className="home-span-4" rows={6} />
      <PanelSkeleton className="home-span-8" rows={6} />
    </>
  );
}

/* ---------------------------------------------------------------------------
   2. Niche Pulse and today's picks
--------------------------------------------------------------------------- */

export async function NichePulseSection({ niches, lastVisitAt }: { niches: string[]; lastVisitAt: string | null }) {
  const pulse = await loadPulse(niches.join("\n"), lastVisitAt);
  const subtitle = pulse.scoped ? `Fast-moving Shorts in ${niches.slice(0, 3).join(", ")}${niches.length > 3 ? "…" : ""} · last 48h` : "Fast-moving Shorts across Outlier · last 48h";

  return (
    <>
      <Panel
        icon={ZapIcon}
        title="Niche Pulse"
        subtitle={
          <>
            <span className="dash-live" aria-hidden="true" />
            {subtitle}
            {pulse.newSinceLastVisit > 0 ? <span className="dash-new">{pulse.newSinceLastVisit} new since your last visit</span> : null}
          </>
        }
        action={
          <Link href="/research/shorts-channels?sort=vph" className="dash-link">
            All rising Shorts →
          </Link>
        }
        className="dash-pulse home-span-8"
        index={3}
      >
        {pulse.topics.length > 0 ? (
          <div className="dash-topics">
            {pulse.topics.slice(0, 8).map((t) => (
              <Link key={t.label} href={`/research/shorts-channels?q=${encodeURIComponent(t.label)}`} className="dash-topic" data-mine={t.mine}>
                {t.mine ? <span className="dash-topic-dot" /> : null}
                {t.label}
              </Link>
            ))}
          </div>
        ) : null}

        {pulse.fastShorts.length === 0 ? (
          <Empty title="No fresh Shorts yet">New uploads appear here as channels sync. Discover channels in your niche to fill this in.</Empty>
        ) : (
          <div className="dash-shorts home-shorts">
            {pulse.fastShorts.map((v, i) => (
              <a
                key={v.id}
                href={`https://www.youtube.com/shorts/${v.youtube_video_id}`}
                target="_blank"
                rel="noreferrer"
                className="dash-short"
                style={{ "--i": i } as CSSProperties}
                title={v.title}
              >
                <span className="dash-short-thumb">
                  <img src={`https://i.ytimg.com/vi/${v.youtube_video_id}/hqdefault.jpg`} alt="" loading="lazy" />
                  <span className="dash-vph" title={v.live ? "Current views per hour" : "Views per hour since upload"}>
                    {formatCompact(Math.round(v.vph))}/h
                  </span>
                </span>
                <span className="dash-short-title">{v.title}</span>
                <span className="dash-short-meta">
                  {v.channel ? v.channel.title : "Unknown channel"} · {formatCompact(v.view_count)} views
                </span>
              </a>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        icon={FlameIcon}
        title="Today's breakout picks"
        subtitle="Small channels beating their usual views"
        tone="pink"
        action={
          <Link href="/viral" className="dash-link">
            More →
          </Link>
        }
        className="home-span-4"
        index={4}
      >
        {pulse.picks.length === 0 ? (
          <Empty title="Today's picks aren't in yet">They&apos;re chosen once a day from the freshest breakouts.</Empty>
        ) : (
          <ul className="dash-list">
            {pulse.picks.map((p) => (
              <li key={p.id}>
                <a href={`https://www.youtube.com/shorts/${p.youtube_video_id}`} target="_blank" rel="noreferrer" className="dash-row">
                  <span className="home-pick-thumb">
                    <img src={`https://i.ytimg.com/vi/${p.youtube_video_id}/mqdefault.jpg`} alt="" loading="lazy" />
                  </span>
                  <span className="dash-row-main">
                    <span className="dash-row-title">{p.video_title}</span>
                    <span className="dash-row-sub">
                      {p.channel_title} · {p.niche}
                    </span>
                  </span>
                  <span className="dash-mult">{p.outlier_multiplier ? formatMultiplier(Number(p.outlier_multiplier)) : "—"}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

export async function HeatingUpSection({ niches, lastVisitAt }: { niches: string[]; lastVisitAt: string | null }) {
  const pulse = await loadPulse(niches.join("\n"), lastVisitAt);
  const top = Math.max(...pulse.movers.map((c) => Number(c.live_vph ?? c.recent_vph ?? 0)), 1);
  return (
    <Panel icon={TrendingIcon} title="Channels heating up" subtitle="Most views per hour in your niches" tone="amber" className="home-span-5" index={6}>
      {pulse.movers.length === 0 ? (
        <Empty title="No movers yet">Channels in your niches show up once they&apos;re in the catalog.</Empty>
      ) : (
        <ul className="dash-list">
          {pulse.movers.map((c) => {
            const vph = Number(c.live_vph ?? c.recent_vph ?? 0);
            // Square root, so one giant channel doesn't flatten the rest.
            const share = Math.sqrt(vph / top);
            return (
              <li key={c.channel_id}>
                <Link href={`/channels/${c.youtube_channel_id}`} className="dash-row home-meter-row">
                  <Avatar src={c.thumbnail_url} />
                  <span className="dash-row-main">
                    <span className="dash-row-title">{c.title}</span>
                    <span className="home-meter" aria-hidden="true">
                      <span style={barStyle(HEAT, share, `${share * 100}%`)} />
                    </span>
                  </span>
                  <span className="dash-metric home-heat-value" style={{ color: scale(HEAT, Math.max(share, 0.45)) }}>
                    {vph ? `${formatCompact(Math.round(vph))}/h` : "—"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------------------------
   3. Competitors: you against them
--------------------------------------------------------------------------- */

function VideoRow({ video }: { video: VideoFeedRow }) {
  const score = video.outlier_score === null ? null : Number(video.outlier_score);
  return (
    <a href={`https://www.youtube.com/watch?v=${video.youtube_video_id}`} target="_blank" rel="noreferrer" className="dash-row">
      <span className="dash-mini-thumb">
        <img src={`https://i.ytimg.com/vi/${video.youtube_video_id}/mqdefault.jpg`} alt="" loading="lazy" />
      </span>
      <span className="dash-row-main">
        <span className="dash-row-title">{video.title}</span>
        <span className="dash-row-sub">
          {video.channel_title} · {formatCompact(video.view_count)} views · {timeAgo(video.published_at)}
        </span>
      </span>
      <span className="dash-metric" data-hot={score !== null && score >= 2}>
        {score !== null ? formatMultiplier(score) : "—"}
      </span>
    </a>
  );
}

export async function CompetitorWatchSection({ userId, ownChannel, competitors }: { userId: string; ownChannel: string | null; competitors: string[] }) {
  const [watch, mine] = await Promise.all([getServices().dashboard.competitorWatch(competitors), loadYourChannels(userId, ownChannel)]);
  const you = mine.own?.channel ?? null;
  const rows = [
    ...(you ? [{ id: you.id, title: you.title, href: `/channels/${you.youtube_channel_id}`, thumb: you.thumbnail_url, subs: you.subscriber_count ?? 0, week: mine.own?.growth.subs7d ?? null, you: true }] : []),
    ...watch.found.map((c) => ({ id: c.id, title: c.title, href: `/channels/${c.youtube_channel_id}`, thumb: c.thumbnail_url, subs: c.subscriber_count ?? 0, week: c.growth.subs7d, you: false })),
  ].sort((a, b) => b.subs - a.subs);
  const top = Math.max(...rows.map((r) => r.subs), 1);

  return (
    <Panel
      icon={UsersIcon}
      title="You vs competitors"
      subtitle={watch.configured ? `Subscribers, and who grew this week` : "Channels you're up against"}
      tone="pink"
      action={
        <Link href="/compare" className="dash-link">
          Compare →
        </Link>
      }
      className="home-span-7"
      index={5}
    >
      {watch.configured === 0 ? (
        <Empty
          title="No competitors yet"
          action={
            <Link href="/settings/preferences" className="button-ghost button-small">
              Add competitors
            </Link>
          }
        >
          Add a few channels to see how you stack up, plus their breakout videos.
        </Empty>
      ) : watch.found.length === 0 ? (
        <Empty
          title="Competitors aren't synced yet"
          action={
            <Link href="/compare" className="button-ghost button-small">
              Load them
            </Link>
          }
        >
          Open Compare once to pull their stats in. After that they refresh daily.
        </Empty>
      ) : (
        <>
          <ul className="home-versus">
            {rows.map((r) => (
              <li key={r.id} data-you={r.you || undefined}>
                <Link href={r.href} className="home-versus-row">
                  <Avatar src={r.thumb} />
                  <span className="home-versus-main">
                    <span className="home-versus-name">
                      {r.title}
                      {r.you ? <em>You</em> : null}
                    </span>
                    <span className="home-versus-bar" aria-hidden="true">
                      {/* Length is to scale; colour uses the square root so the smaller channels still differ from each other. */}
                      <span style={barStyle(r.you ? VIOLET : PINK, Math.sqrt(r.subs / top), `${Math.max((r.subs / top) * 100, 2)}%`)} />
                    </span>
                  </span>
                  <span className="home-versus-value">
                    <strong>{formatCompact(r.subs)}</strong>
                    <Delta value={r.week} suffix="7d" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <h3 className="dash-subhead">
            <FlameIcon size={14} /> Their best this month
          </h3>
          {watch.topPerformers.length === 0 ? (
            <p className="dash-footnote">No breakouts from them in the last 30 days.</p>
          ) : (
            <ul className="dash-list">
              {watch.topPerformers.slice(0, 3).map((v) => (
                <li key={v.video_id}>
                  <VideoRow video={v} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {watch.missing.length > 0 && watch.found.length > 0 ? <p className="dash-footnote">Not synced yet: {watch.missing.slice(0, 3).join(", ")}</p> : null}
    </Panel>
  );
}

/* ---------------------------------------------------------------------------
   Saved niches (from the Niche Finder)
--------------------------------------------------------------------------- */

export async function SavedNichesSection({ saved }: { saved: SavedNiche[] }) {
  if (saved.length === 0) return null;
  const niches = await getServices().niches.savedWithScores(saved.slice(0, 8));
  return (
    <Panel
      icon={CompassIcon}
      title="Niches you're watching"
      subtitle="Opportunity scores now, and the change since you saved them"
      tone="blue"
      action={
        <Link href="/research/niche-finder" className="dash-link">
          Niche Finder →
        </Link>
      }
      className="home-span-12"
      index={7}
    >
      <ul className="home-niches">
        {niches.map((n) => {
          const now = n.current ?? n.score;
          const delta = n.current === null ? 0 : n.current - n.score;
          return (
            <li key={n.key}>
              <Link href={`/research/niche-finder?topic=${encodeURIComponent(n.topic)}`} className="home-niche">
                <span className="home-niche-name">{n.topic}</span>
                <span className="home-niche-score" data-band={now >= 65 ? "high" : now >= 45 ? "mid" : "low"}>
                  {now}
                </span>
                <span className="home-niche-delta" data-dir={delta > 0 ? "up" : delta < 0 ? "down" : "flat"}>
                  {delta > 0 ? `▲ ${delta}` : delta < 0 ? `▼ ${-delta}` : "—"}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/* ---------------------------------------------------------------------------
   4. Tracked channels, recent activity, shortcuts
--------------------------------------------------------------------------- */

export async function TrackedSection({ userId, ownChannel }: { userId: string; ownChannel: string | null }) {
  const data = await loadYourChannels(userId, ownChannel);
  return (
    <Panel
      icon={BookmarkIcon}
      title="Tracked channels"
      subtitle="Biggest movers in the last 24h"
      tone="green"
      action={
        <Link href="/channels" className="dash-link">
          All →
        </Link>
      }
      className="home-span-4"
      index={7}
    >
      {data.tracked.length === 0 ? (
        <Empty
          title="Nothing tracked yet"
          action={
            <Link href="/research/shorts-channels" className="button-ghost button-small">
              Find channels
            </Link>
          }
        >
          Track a channel to follow its growth every day.
        </Empty>
      ) : (
        <ul className="dash-list">
          {data.tracked.map((c) => (
            <li key={c.id}>
              <Link href={`/channels/${c.youtube_channel_id}`} className="dash-row">
                <Avatar src={c.thumbnail_url} />
                <span className="dash-row-main">
                  <span className="dash-row-title">{c.title}</span>
                  <span className="dash-row-sub">{formatCompact(c.subscriber_count)} subs</span>
                </span>
                <Delta value={c.growth.views24h} suffix="views" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const ACTIVITY_ICON: Record<ActivityItem["kind"], IconType> = { search: SearchIcon, track: BookmarkIcon, analyze: ChartIcon, other: ZapIcon };

export async function RecentActivitySection({ userId, lastVisitAt }: { userId: string; lastVisitAt: string | null }) {
  const [items, overview] = await Promise.all([getServices().dashboard.recentActivity(userId, 5), loadOverview(userId, lastVisitAt)]);
  return (
    <Panel
      icon={ShortsIcon}
      title="Recent activity"
      subtitle={`${overview.researchThisWeek} research ${overview.researchThisWeek === 1 ? "action" : "actions"} this week`}
      tone="blue"
      className="home-span-4"
      index={8}
    >
      {items.length === 0 ? (
        <Empty title="Nothing yet">Your searches, tracked channels, and analyzed videos will show up here.</Empty>
      ) : (
        <ul className="dash-list dash-activity">
          {items.map((item) => {
            const Icon = ACTIVITY_ICON[item.kind];
            const body = (
              <>
                <span className="dash-activity-icon">
                  <Icon size={14} />
                </span>
                <span className="dash-row-main">
                  <span className="dash-row-title">{item.label}</span>
                </span>
                <span className="dash-row-sub">{timeAgo(item.at)}</span>
              </>
            );
            return <li key={item.id}>{item.href ? <Link href={item.href} className="dash-row">{body}</Link> : <div className="dash-row">{body}</div>}</li>;
          })}
        </ul>
      )}
    </Panel>
  );
}

const SHORTCUTS: { href: string; label: string; note: string; icon: IconType; tone: Tone; ownerOnly?: boolean }[] = [
  { href: "/research/shorts-channels", label: "Search Channels", note: "Find Shorts channels by niche", icon: SearchIcon, tone: "violet" },
  { href: "/viral", label: "Viral Videos", note: "Videos beating their channel", icon: FlameIcon, tone: "pink" },
  { href: "/analyze", label: "Analyze Video", note: "Why did it take off?", icon: ChartIcon, tone: "blue" },
  { href: "/research/niche-finder", label: "Find Ideas", note: "Research niches and sub-niches", icon: CompassIcon, tone: "amber" },
  // Still owner-only. Everyone else sees it here and lands on the locked preview.
  { href: "/research/scriptwriter", label: "Script Writer", note: "Write a Short from the niche's outliers", icon: PenIcon, tone: "green", ownerOnly: true },
];

export function ResearchShortcuts({ isOwner = false }: { isOwner?: boolean }) {
  return (
    <Panel title="Jump into a tool" className="home-span-4 dash-shortcuts-panel" index={9}>
      <div className="dash-shortcuts home-shortcuts">
        {SHORTCUTS.map((s, i) => {
          const locked = s.ownerOnly === true && !isOwner;
          return (
            <Link key={s.href} href={s.href} className="dash-shortcut" data-locked={locked ? "" : undefined} style={{ "--i": i } as CSSProperties}>
              <span className="dash-icon" data-tone={s.tone}>
                <s.icon size={16} />
              </span>
              <span className="dash-shortcut-text">
                <strong>
                  {s.label}
                  {locked ? <span className="dash-soon">Coming soon</span> : null}
                </strong>
                <span>{s.note}</span>
              </span>
              <span className="dash-shortcut-arrow" aria-hidden="true">
                {locked ? <LockIcon size={14} /> : "→"}
              </span>
            </Link>
          );
        })}
      </div>
    </Panel>
  );
}
