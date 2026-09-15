/* eslint-disable @next/next/no-img-element -- YouTube images are already CDN-optimized */
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import {
  BookmarkIcon,
  ChartIcon,
  CompassIcon,
  EyeIcon,
  FlameIcon,
  PlayCircleIcon,
  SearchIcon,
  ShortsIcon,
  TrendingIcon,
  UsersIcon,
  ZapIcon,
} from "@/components/icons";
import type { ActivityItem } from "@/lib/analytics/dashboard";
import { formatCompact, formatMultiplier, timeAgo } from "@/lib/format";
import { getServices } from "@/lib/services";
import type { VideoFeedRow } from "@/types/database";

type IconType = ComponentType<{ size?: number }>;

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
  icon: IconType;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: "violet" | "pink" | "green" | "amber" | "blue";
  index?: number;
}) {
  return (
    <section className={`dash-panel ${className}`} style={{ "--i": index } as React.CSSProperties} aria-label={title}>
      <header className="dash-panel-head">
        <span className="dash-icon" data-tone={tone}>
          <Icon size={16} />
        </span>
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

function Delta({ value, suffix }: { value: number | null; suffix: string }) {
  if (value === null) return <span className="dash-delta" data-dir="none">— {suffix}</span>;
  const dir = value > 0 ? "up" : value < 0 ? "down" : "flat";
  return (
    <span className="dash-delta" data-dir={dir}>
      {value > 0 ? "+" : value < 0 ? "−" : ""}
      {formatCompact(Math.abs(value))} {suffix}
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

/* ---------------------------------------------------------------------------
   1. Overview stats
--------------------------------------------------------------------------- */

export async function OverviewStats({ userId, lastVisitAt, niches }: { userId: string; lastVisitAt: string | null; niches: number }) {
  const overview = await getServices().dashboard.overview(userId, lastVisitAt);
  const { credits } = overview;
  const creditShare = credits.limit > 0 ? Math.min(credits.remaining / credits.limit, 1) : 0;
  const unlimited = credits.limit >= 1_000_000;

  const stats: { label: string; value: string; note: string; href: string }[] = [
    { label: "Tracked channels", value: formatCompact(overview.trackedChannels), note: "refreshed daily", href: "/channels" },
    { label: "Research this week", value: String(overview.researchThisWeek), note: "searches, tracks, analyses", href: "/research/shorts-channels" },
    { label: "Your niches", value: String(niches), note: niches ? "shaping your pulse" : "add some in preferences", href: "/settings/preferences" },
  ];

  return (
    <div className="dash-stats">
      {stats.map((s, i) => (
        <Link key={s.label} href={s.href} className="dash-stat" style={{ "--i": i } as React.CSSProperties}>
          <span className="dash-stat-label">{s.label}</span>
          <span className="dash-stat-value">{s.value}</span>
          <span className="dash-stat-note">{s.note}</span>
        </Link>
      ))}
      <div className="dash-stat" style={{ "--i": 3 } as React.CSSProperties}>
        <span className="dash-stat-label">Credits today</span>
        <span className="dash-stat-value">{unlimited ? "∞" : formatCompact(credits.remaining)}</span>
        {unlimited ? (
          <span className="dash-stat-note">unlimited</span>
        ) : (
          <>
            <span className="dash-meter" role="meter" aria-valuemin={0} aria-valuemax={credits.limit} aria-valuenow={credits.remaining}>
              <span style={{ width: `${creditShare * 100}%` }} />
            </span>
            <span className="dash-stat-note">of {formatCompact(credits.limit)} · resets midnight UTC</span>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   2. Niche Pulse
--------------------------------------------------------------------------- */

export async function NichePulseSection({ niches, lastVisitAt }: { niches: string[]; lastVisitAt: string | null }) {
  const pulse = await getServices().dashboard.nichePulse(niches, lastVisitAt);
  const subtitle = pulse.scoped ? `Moving right now in ${niches.slice(0, 3).join(", ")}${niches.length > 3 ? "…" : ""}` : "Moving right now across Outlier";

  return (
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
      className="dash-pulse"
      index={0}
    >
      {pulse.topics.length > 0 ? (
        <div className="dash-topics">
          {pulse.topics.map((t) => (
            <Link key={t.label} href={`/research/shorts-channels?q=${encodeURIComponent(t.label)}`} className="dash-topic" data-mine={t.mine}>
              {t.mine ? <span className="dash-topic-dot" /> : null}
              {t.label}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="dash-pulse-grid">
        <div>
          <h3 className="dash-subhead">
            <ShortsIcon size={14} /> Fast-moving Shorts <span>· last 48h</span>
          </h3>
          {pulse.fastShorts.length === 0 ? (
            <Empty title="No fresh Shorts yet">New uploads appear here as channels sync. Discover channels in your niche to fill this in.</Empty>
          ) : (
            <div className="dash-shorts">
              {pulse.fastShorts.map((v, i) => (
                <a
                  key={v.id}
                  href={`https://www.youtube.com/shorts/${v.youtube_video_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="dash-short"
                  style={{ "--i": i } as React.CSSProperties}
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
        </div>

        <div className="dash-side">
          <h3 className="dash-subhead">
            <TrendingIcon size={14} /> Channels heating up
          </h3>
          {pulse.movers.length === 0 ? (
            <Empty title="No movers yet">Channels in your niches show up once they&apos;re in the catalog.</Empty>
          ) : (
            <ul className="dash-list">
              {pulse.movers.map((c) => (
                <li key={c.channel_id}>
                  <Link href={`/channels/${c.youtube_channel_id}`} className="dash-row">
                    {c.thumbnail_url ? <img className="dash-avatar" src={c.thumbnail_url} alt="" loading="lazy" /> : <span className="dash-avatar" />}
                    <span className="dash-row-main">
                      <span className="dash-row-title">{c.title}</span>
                      <span className="dash-row-sub">
                        {formatCompact(c.subscriber_count)} subs
                        {c.top_multiplier ? ` · best ${formatMultiplier(Number(c.top_multiplier))}` : ""}
                      </span>
                    </span>
                    <span className="dash-metric">{c.live_vph ?? c.recent_vph ? `${formatCompact(Math.round(Number(c.live_vph ?? c.recent_vph)))}/h` : "—"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {pulse.picks.length > 0 ? (
            <>
              <h3 className="dash-subhead">
                <FlameIcon size={14} /> Today&apos;s breakout picks
              </h3>
              <ul className="dash-list">
                {pulse.picks.map((p) => (
                  <li key={p.id}>
                    <a href={`https://www.youtube.com/shorts/${p.youtube_video_id}`} target="_blank" rel="noreferrer" className="dash-row">
                      <span className="dash-mult">{p.outlier_multiplier ? formatMultiplier(Number(p.outlier_multiplier)) : "—"}</span>
                      <span className="dash-row-main">
                        <span className="dash-row-title">{p.video_title}</span>
                        <span className="dash-row-sub">
                          {p.channel_title} · {p.niche}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------------------
   3. Your Channels
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
          {formatCompact(video.view_count)} views · {timeAgo(video.published_at)}
        </span>
      </span>
      <span className="dash-metric" data-hot={score !== null && score >= 2}>
        {score !== null ? formatMultiplier(score) : "—"}
      </span>
    </a>
  );
}

export async function YourChannelsSection({ ownChannel }: { ownChannel: string | null }) {
  const data = await getServices().dashboard.yourChannels(ownChannel);
  const own = data.own;

  return (
    <Panel
      icon={PlayCircleIcon}
      title="Your Channels"
      subtitle="Performance and anything unusual"
      tone="green"
      action={
        <Link href="/channels" className="dash-link">
          Manage →
        </Link>
      }
      index={1}
    >
      {own ? (
        <div className="dash-own">
          <div className="dash-own-head">
            {own.channel.thumbnail_url ? <img className="dash-avatar dash-avatar-lg" src={own.channel.thumbnail_url} alt="" /> : <span className="dash-avatar dash-avatar-lg" />}
            <div className="dash-row-main">
              <Link href={`/channels/${own.channel.youtube_channel_id}`} className="dash-own-name">
                {own.channel.title}
              </Link>
              <span className="dash-row-sub">{formatCompact(own.channel.subscriber_count)} subscribers</span>
            </div>
          </div>
          <div className="dash-deltas">
            <Delta value={own.growth.subs24h} suffix="subs 24h" />
            <Delta value={own.growth.subs7d} suffix="subs 7d" />
            <Delta value={own.growth.views24h} suffix="views 24h" />
            <Delta value={own.growth.views7d} suffix="views 7d" />
          </div>
          {own.alerts.length > 0 ? (
            <ul className="dash-alerts">
              {own.alerts.map((a) => (
                <li key={a.title} className="dash-alert" data-tone={a.tone}>
                  <strong>{a.title}</strong>
                  <span>{a.detail}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {own.recent.length > 0 ? (
            <>
              <h3 className="dash-subhead">Recent uploads</h3>
              <ul className="dash-list">
                {own.recent.slice(0, 3).map((v) => (
                  <li key={v.video_id}>
                    <VideoRow video={v} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : data.ownPending ? (
        <Empty
          title="Your channel isn't synced yet"
          action={
            <Link href={`/compare?you=${encodeURIComponent(data.ownPending)}`} className="button-ghost button-small">
              Load my channel
            </Link>
          }
        >
          We&apos;ll pull in {data.ownPending} so you can see growth and alerts here.
        </Empty>
      ) : (
        <Empty
          title="Add your channel"
          action={
            <Link href="/settings/preferences" className="button-ghost button-small">
              Add in preferences
            </Link>
          }
        >
          See your subscriber and view changes, plus alerts when a video breaks out.
        </Empty>
      )}

      {data.tracked.length > 0 ? (
        <>
          <h3 className="dash-subhead">
            <BookmarkIcon size={14} /> Tracked · biggest movers
          </h3>
          <ul className="dash-list">
            {data.tracked.map((c) => (
              <li key={c.id}>
                <Link href={`/channels/${c.youtube_channel_id}`} className="dash-row">
                  {c.thumbnail_url ? <img className="dash-avatar" src={c.thumbnail_url} alt="" loading="lazy" /> : <span className="dash-avatar" />}
                  <span className="dash-row-main">
                    <span className="dash-row-title">{c.title}</span>
                    <span className="dash-row-sub">{formatCompact(c.subscriber_count)} subs</span>
                  </span>
                  <Delta value={c.growth.views24h} suffix="24h" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Panel>
  );
}

/* ---------------------------------------------------------------------------
   4. Competitor Watch
--------------------------------------------------------------------------- */

export async function CompetitorWatchSection({ competitors }: { competitors: string[] }) {
  const watch = await getServices().dashboard.competitorWatch(competitors);
  const compareHref = `/compare`;

  return (
    <Panel
      icon={UsersIcon}
      title="Competitor Watch"
      subtitle={watch.configured ? `${watch.found.length} of ${watch.configured} competitors synced` : "Channels you're up against"}
      tone="pink"
      action={
        <Link href={compareHref} className="dash-link">
          Compare →
        </Link>
      }
      index={2}
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
          Add a few channels to see their new uploads, breakouts, and growth here.
        </Empty>
      ) : watch.found.length === 0 ? (
        <Empty
          title="Competitors aren't synced yet"
          action={
            <Link href={compareHref} className="button-ghost button-small">
              Load them
            </Link>
          }
        >
          Open Compare once to pull their stats in. After that they refresh daily.
        </Empty>
      ) : (
        <>
          <ul className="dash-list">
            {watch.found.slice(0, 5).map((c) => (
              <li key={c.id}>
                <Link href={`/channels/${c.youtube_channel_id}`} className="dash-row">
                  {c.thumbnail_url ? <img className="dash-avatar" src={c.thumbnail_url} alt="" loading="lazy" /> : <span className="dash-avatar" />}
                  <span className="dash-row-main">
                    <span className="dash-row-title">{c.title}</span>
                    <span className="dash-row-sub">{formatCompact(c.subscriber_count)} subs</span>
                  </span>
                  <Delta value={c.growth.subs7d} suffix="subs 7d" />
                </Link>
              </li>
            ))}
          </ul>

          <h3 className="dash-subhead">
            <FlameIcon size={14} /> Biggest performers · 30d
          </h3>
          {watch.topPerformers.length === 0 ? (
            <Empty title="No breakouts this month" />
          ) : (
            <ul className="dash-list">
              {watch.topPerformers.map((v) => (
                <li key={v.video_id}>
                  <VideoRow video={v} />
                </li>
              ))}
            </ul>
          )}

          <h3 className="dash-subhead">
            <EyeIcon size={14} /> Recent uploads · 14d
          </h3>
          {watch.uploads.length === 0 ? (
            <Empty title="Nothing new in two weeks" />
          ) : (
            <ul className="dash-list">
              {watch.uploads.slice(0, 4).map((v) => (
                <li key={v.video_id}>
                  <VideoRow video={v} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {watch.missing.length > 0 && watch.found.length > 0 ? (
        <p className="dash-footnote">Not synced yet: {watch.missing.slice(0, 3).join(", ")}</p>
      ) : null}
    </Panel>
  );
}

/* ---------------------------------------------------------------------------
   5. Research shortcuts
--------------------------------------------------------------------------- */

const SHORTCUTS: { href: string; label: string; note: string; icon: IconType; tone: string }[] = [
  { href: "/research/shorts-channels", label: "Search Channels", note: "Find Shorts channels by niche", icon: SearchIcon, tone: "violet" },
  { href: "/viral", label: "Viral Videos", note: "Videos beating their channel", icon: FlameIcon, tone: "pink" },
  { href: "/analyze", label: "Analyze Video", note: "Why did it take off?", icon: ChartIcon, tone: "blue" },
  { href: "/research/niche-finder", label: "Find Ideas", note: "Research niches and sub-niches", icon: CompassIcon, tone: "amber" },
];

export function ResearchShortcuts() {
  return (
    <div className="dash-shortcuts">
      {SHORTCUTS.map((s, i) => (
        <Link key={s.href} href={s.href} className="dash-shortcut" style={{ "--i": i } as React.CSSProperties}>
          <span className="dash-icon" data-tone={s.tone}>
            <s.icon size={18} />
          </span>
          <span className="dash-shortcut-text">
            <strong>{s.label}</strong>
            <span>{s.note}</span>
          </span>
          <span className="dash-shortcut-arrow" aria-hidden="true">
            →
          </span>
        </Link>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   6. Recent activity
--------------------------------------------------------------------------- */

const ACTIVITY_ICON: Record<ActivityItem["kind"], IconType> = { search: SearchIcon, track: BookmarkIcon, analyze: ChartIcon, other: ZapIcon };

export async function RecentActivitySection({ userId }: { userId: string }) {
  const items = await getServices().dashboard.recentActivity(userId);
  return (
    <Panel icon={BookmarkIcon} title="Recent activity" subtitle="Pick up where you left off" tone="blue" index={4}>
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
